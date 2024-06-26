import {Auth0Options, OAuth2Auth, Options, SecretKeyAuth, SessionAuth, TransientPopId} from "./options"
import {
    EndpointState,
    FileSource,
    IngressEvent,
    LiveMedia,
    LiveSource,
    PathSource,
    ResultStream,
    SessionPlus,
    Source,
    SourceParams,
    StreamSource,
    UrlSource
} from "./types"
import {AbstractJob, LoadFromJob, LoadLiveIngressJob, UploadJob} from "./jobs"
import {createHttpClient, HttpClient} from './shims/http_client'
import {Semaphore} from "./semaphore"
import {WebrtcWhip} from "./webrtc_whip"
import {WebrtcWhep} from "./webrtc_whep"
import {resolvePath} from "./shims/local_file"

import {Logger, pino} from "pino"
import {authenticateBrowserSession} from "./shims/browser_session"

interface PopConfig {
    base_url: string;
    pipeline_id: string;
    name: string;
}

interface Pipeline {
    id: string
    startTime: string
    state: string
    prePipeline: string | null
    inferPipeline: string
    postTransform: string | null
}

interface AccessToken {
    access_token: string;
    expires_in: number;
    token_type: string;
}

interface WsAuthToken {
    token: string;
}

export class Endpoint {
    private _options: Options
    private _token: string | null
    private _expire_token_time: number | null
    private _baseUrl: string | null
    private _pipelineId: string | null
    private _sandboxId: string | null

    private _popName: string | null

    private _pipeline: Pipeline | null

    private _client: HttpClient | null

    private _limit: Semaphore

    private _state: EndpointState
    private _stateChangeHandler: null | ((fromState: EndpointState, toState: EndpointState) => void)
    private _ingressEventHandler: null | ((event: IngressEvent) => void)
    private _ingressEventWs: WebSocket | null

    private _logger: Logger
    private readonly _requestLogger: Logger

    constructor(options: Options) {
        this._options = options
        this._baseUrl = null
        this._pipelineId = null
        this._popName = null
        this._token = null
        this._expire_token_time = null
        this._client = null
        this._state = EndpointState.Idle
        this._pipeline = null
        this._stateChangeHandler = null
        this._ingressEventHandler = null
        this._ingressEventWs = null

        this._sandboxId = null
        const sessionAuth: SessionAuth = (options.auth as SessionAuth)
        if (sessionAuth.session !== undefined) {
            const sessionPlus = (sessionAuth.session as SessionPlus)
            if (sessionPlus.sandboxId) {
                this._sandboxId = sessionPlus.sandboxId
            }
        }

        this._limit = new Semaphore(this._options.jobQueueLength ?? 1024)

        let rootLogger
        if (options.logger) {
            rootLogger = options.logger
        } else {
            rootLogger = pino()
        }
        this._logger = rootLogger.child({module: 'eyepop'})
        this._requestLogger = this._logger.child({module: 'requests'})
    }

    public eyepopUrl(): string {
        if (this._options.eyepopUrl) {
            return this._options.eyepopUrl.replace(/\/+$/, '')
        } else {
            return 'https://api.eyepop.ai'
        }
    }

    public state(): EndpointState {
        return this._state
    }

    public pendingJobs(): number {
        return (this._options.jobQueueLength ?? 1024) - this._limit.getPermits()
    }

    public popName(): string | null {
        return this._popName
    }

    public popComp(): string | null {
        if (this._pipeline) {
            return this._pipeline.inferPipeline
        } else {
            return null
        }
    }

    public postTransform(): string | null {
        if (this._pipeline) {
            return this._pipeline.postTransform
        } else {
            return null
        }
    }

    public async changePopComp(popComp: string): Promise<void> {
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject("endpoint not connected, use connect() before changePopComp()")
        }
        const body = {
            'pipeline': popComp
        }

        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            }
            const patch_url = `${session.baseUrl}/pipelines/${session.pipelineId}/inferencePipeline`
            return client.fetch(patch_url, {
                method: 'PATCH',
                body: JSON.stringify(body),
                headers: headers
            })
        })
        if (response.status != 204) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        if (this._pipeline) {
            this._pipeline.inferPipeline = popComp
        }
    }

    public async changePostTransform(postTransform: string | null): Promise<void> {
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject("endpoint not connected, use connect() before changePopComp()")
        }

        postTransform = postTransform? postTransform: null

        const body = {
            'transform': postTransform
        }

        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            }
            const patch_url = `${session.baseUrl}/pipelines/${session.pipelineId}/postTransform`
            return client.fetch(patch_url, {
                method: 'PATCH',
                body: JSON.stringify(body),
                headers: headers
            })
        })
        if (response.status != 204) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        if (this._pipeline) {
            this._pipeline.postTransform = postTransform
        }
    }

    public popId(): string | null {
        return this._options.popId || null
    }

    public onStateChanged(handler: (fromState: EndpointState, toState: EndpointState) => void): Endpoint {
        this._stateChangeHandler = handler
        return this
    }

    public onIngressEvent(handler: (event: IngressEvent) => void): Endpoint {
        this._ingressEventHandler = handler
        this.startIngressWs().then(() => {
        }).catch((reason) => {
            this._logger.warn('unexpected error starting the ingress event handler: %s', reason)
        })
        return this
    }

    public async connect(): Promise<Endpoint> {
        if (this._client) {
            this._logger.warn('endpoint already connected')
            return this
        }
        if (!this._options.eyepopUrl) {
            return Promise.reject("option eyepopUrl or environment variable EYEPOP_URL is required")
        }
        if (!this._options.popId) {
            return Promise.reject("option popId or environment variable EYEPOP_POP_ID is required")
        }
        if (this._options.auth === undefined) {
            return Promise.reject("cannot connect without defined auth option")
        }
        if ((this._options.auth as SessionAuth).session !== undefined) {
            this._token = (this._options.auth as SessionAuth).session.accessToken
            this._expire_token_time = (this._options.auth as SessionAuth).session.validUntil / 1000
        } else if ((this._options.auth as OAuth2Auth).oAuth2 !== undefined) {

        } else if ((this._options.auth as SecretKeyAuth).secretKey !== undefined) {

        } else {
            return Promise.reject("option secretKey or environment variable EYEPOP_SECRET_KEY is required")
        }

        this._client = await createHttpClient()
        const client = this._client

        let result: Endpoint = await this.reconnect()

        if (this._baseUrl && this._options.stopJobs) {
            const body = {'sourceType': 'NONE'}
            let response = await this.fetchWithRetry(async () => {
                const session = await this.session()
                const headers = {
                    'Authorization': `Bearer ${session.accessToken}`,
                    'Content-Type': 'application/json'
                }
                const stop_url = `${session.baseUrl}/pipelines/${session.pipelineId}/source?mode=preempt&processing=sync`
                return client.fetch(stop_url, {
                    method: 'PATCH',
                    headers: headers,
                    body: JSON.stringify(body)
                })
            })
            if (response.status >= 300) {
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
        }

        if (!this._ingressEventWs && this._ingressEventHandler) {
            await this.startIngressWs()
        }

        return result;
    }

    public async disconnect(wait: boolean = true): Promise<void> {
        if (wait && this._limit) {
            // @ts-ignore
            for (let j = 0; j < this._options.jobQueueLength; j++) {
                await this._limit.acquire()
            }
        }

        this._limit = new Semaphore(this._options.jobQueueLength ?? 1024)

        if (this._client) {
            await this._client.close()
            this._client = null
        }
        this._baseUrl = null
        this._pipelineId = null
        this._sandboxId = null
    }

    public async session(): Promise<SessionPlus> {
        await this.currentAccessToken()
        if (this._token == null || this._expire_token_time == null) {
            return Promise.reject("endpoint not connected")
        }
        if (this._baseUrl == null || this._pipelineId == null) {
            await this.reconnect()
            if (this._baseUrl == null || this._pipelineId == null) {
                return Promise.reject("endpoint not connected")
            }
        }
        return {
            eyepopUrl: <string>this._options.eyepopUrl,
            popId: <string>this._options.popId,
            accessToken: this._token,
            validUntil: this._expire_token_time * 1000,
            baseUrl: this._baseUrl,
            pipelineId: this._pipelineId,
            sandboxId: this._sandboxId?? undefined
        }
    }

    public async liveIngress(stream: MediaStream): Promise<LiveMedia> {
        if (!this._baseUrl || !this._client) {
            return Promise.reject("endpoint not connected, use connect() before ingress()")
        }
        const whip = new WebrtcWhip(stream, async () => {
            return this.session()
        }, this._client, this._requestLogger)
        return whip.start()
    }

    public async liveEgress(ingressId: string): Promise<LiveMedia> {
        if (!this._baseUrl || !this._client) {
            return Promise.reject("endpoint not connected, use connect() before ingress()")
        }
        const whep = new WebrtcWhep(ingressId, async () => {
            return this.session()
        }, this._client, this._requestLogger)
        return whep.start()
    }

    public async process(source: Source, params: SourceParams | undefined = undefined): Promise<ResultStream> {
        if ((source as FileSource).file !== undefined) {
            return this.uploadFile(source as FileSource, params)
        } else if ((source as StreamSource).stream !== undefined) {
            return this.uploadStream(source as StreamSource, params)
        } else if ((source as PathSource).path !== undefined) {
            return this.uploadPath(source as PathSource, params)
        } else if ((source as UrlSource).url !== undefined) {
            return this.loadFrom(source as UrlSource, params)
        } else if ((source as LiveSource).ingressId !== undefined) {
            return this.loadLiveIngress(source as LiveSource, params)
        } else {
            return Promise.reject('unknown source type')
        }
    }

    private async startIngressWs(): Promise<void> {
        const client = this._client
        if (this._ingressEventWs || !this._baseUrl || !client) {
            return;
        }
        try {
            const session = await this.session()
            let response = await this.fetchWithRetry(async () => {
                const headers = {
                    'Authorization': `Bearer ${session.accessToken}`
                }
                const getTokenUrl = `${session.baseUrl}/liveIngress/events/token`
                return client.fetch(getTokenUrl, {headers: headers})
            })
            if (response.status != 200) {
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
            const wsAuthToken = (await response.json()) as WsAuthToken
            const wsUrl = this._baseUrl.startsWith('https://') ? `${this._baseUrl.replace('https://', 'wss://')}/liveIngress/events/${wsAuthToken.token}` : `${this._baseUrl.replace('http://', 'ws://')}/liveIngress/events/${wsAuthToken.token}`;

            this._ingressEventWs = new WebSocket(wsUrl)
            this._ingressEventWs.addEventListener('message', (event: MessageEvent) => {
                const ingressEvent = JSON.parse(event.data) as IngressEvent;
                if (this._ingressEventHandler) {
                    this._ingressEventHandler(ingressEvent)
                }
            })
        } finally {
            this.updateState()
        }
    }

    private async uploadFile(source: FileSource, params: SourceParams | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            return Promise.reject("endpoint not connected, use connect() before upload()")
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new UploadJob(source.file, source.file.type, params,async () => {
                return this.session()
            }, this._client, this._requestLogger)
            return job.start(() => {
                this.jobDone(job)
            }, (statusCode: number) => {
                this.jobStatus(job, statusCode)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async uploadStream(source: StreamSource, params: SourceParams | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            return Promise.reject("endpoint not connected, use connect() before upload()")
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new UploadJob(source.stream, source.mimeType, params,async () => {
                return this.session()
            }, this._client, this._requestLogger)
            return job.start(() => {
                this.jobDone(job)
            }, (statusCode: number) => {
                this.jobStatus(job, statusCode)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async uploadPath(source: PathSource, params: SourceParams | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error("endpoint not connected, use connect() before process()")
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const streamSource = await resolvePath(source as PathSource)
            const job = new UploadJob(streamSource.stream, streamSource.mimeType, params,async () => {
                return this.session()
            }, this._client, this._requestLogger)
            return job.start(() => {
                this.jobDone(job)
            }, (statusCode: number) => {
                this.jobStatus(job, statusCode)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async loadFrom(source: UrlSource, params: SourceParams | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error("endpoint not connected, use connect() before loadFrom()")
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new LoadFromJob(source.url, params,async () => {
                return this.session()
            }, this._client, this._requestLogger)
            return job.start(() => {
                this.jobDone(job)
            }, (statusCode: number) => {
                this.jobStatus(job, statusCode)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async loadLiveIngress(source: LiveSource, params: SourceParams | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error("endpoint not connected, use connect() before loadLiveIngress()")
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new LoadLiveIngressJob(source.ingressId, params,async () => {
                return this.session()
            }, this._client, this._requestLogger)
            return job.start(() => {
                this.jobDone(job)
            }, (statusCode: number) => {
                this.jobStatus(job, statusCode)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private jobDone(job: AbstractJob) {
        this._limit?.release()
        this.updateState()
    }

    private updateState(newState: EndpointState | undefined = undefined) {
        const fromState = this._state
        if (newState == undefined) {
            if (this._limit.getPermits() == this._options.jobQueueLength) {
                newState = EndpointState.Idle
            } else {
                newState = EndpointState.Busy
            }
        }
        this._state = newState
        if (this._stateChangeHandler) {
            this._stateChangeHandler(fromState, this._state)
        }
    }

    private jobStatus(job: AbstractJob, statusCode: number) {
        if (statusCode == 404) {
            this._pipelineId = null;
            this._baseUrl = null;
        } else if (statusCode == 401) {
            this._token = null;
            this._expire_token_time = null;
        }
    }

    private async fetchWithRetry(fetcher: () => Promise<Response>, retries: number = 1): Promise<Response> {
        while (true) {
            try {
                const response = await fetcher()
                if (response.status == 401) {
                    this._token = null;
                    this._expire_token_time = null;
                    if (retries--) {
                        this._requestLogger.info('received 401 response, attempt to reauthorize and retry')
                    } else {
                        return Promise.reject(`response ${response.status}: ${response.statusText}`)
                    }
                } else if (response.status == 404) {
                    this._pipelineId = null;
                    this._baseUrl = null;
                    if (retries--) {
                        this._requestLogger.info('received 404 response, attempt to restart pop and retry')
                    } else {
                        return Promise.reject(`response ${response.status}: ${response.statusText}`)
                    }
                } else {
                    return response
                }
            } catch (error) {
                this._pipelineId = null;
                this._baseUrl = null;
                if (retries--) {
                    this._requestLogger.info('unknown, attempt to restart pop (as if we received 404)', error)
                    return Promise.reject(error)
                }
            }
        }
    }

    private async reconnect(): Promise<Endpoint> {
        if (!this._client) {
            return Promise.reject("endpoint not initialized")
        }
        let config_url
        if (this._options.popId == TransientPopId.Transient) {
            config_url = `${this.eyepopUrl()}/workers/config`
        } else {
            config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=false`
        }
        const headers = {
            'Authorization': await this.authorizationHeader()
        }
        this.updateState(EndpointState.FetchConfig)
        this._requestLogger.debug('before GET %s', config_url)
        let response = await this._client.fetch(config_url, {headers: headers})
        if (response.status == 401) {
            this._requestLogger.debug('after GET %s: 401, about to retry with fresh access token', config_url)
            // one retry, the token might have just expired
            this._token = null
            const headers = {
                'Authorization': await this.authorizationHeader()
            }
            this.updateState(EndpointState.FetchConfig)
            response = await this._client.fetch(config_url, {
                headers: headers
            })
        }

        if (response.status != 200) {
            this.updateState(EndpointState.Error)
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        } else {
            let config = (await response.json()) as PopConfig
            if (!config.base_url && this._options.autoStart) {
                const auto_start_config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=true`
                this._requestLogger.debug('pop was not running, trying to autostart with: %s', auto_start_config_url)
                // one retry the pop might just have stopped
                const headers = {
                    'Authorization': await this.authorizationHeader()
                }
                this.updateState(EndpointState.StartingPop)
                response = await this._client.fetch(auto_start_config_url, {
                    headers: headers
                })
                if (response.status != 200) {
                    this.updateState(EndpointState.Error)
                    const message = await response.text()
                    return Promise.reject(`Unexpected status ${response.status}: ${message}`)
                }
                config = (await response.json()) as PopConfig
            }

            const baseUrl = new URL(config.base_url, this.eyepopUrl())
            this._baseUrl = baseUrl.toString()
            if (this._options.popId == TransientPopId.Transient) {
                this._pipelineId = await this.startPopLessPipeline()
                this._popName = this._options.popId
            } else {
                this._pipelineId = config.pipeline_id
                this._popName = config.name
            }
            this._requestLogger.debug('after GET %s: %s / %s', config_url, this._baseUrl, this._pipelineId)
            if (!this._pipelineId || !this._baseUrl) {
                return Promise.reject(`Pop not started`)
            }
            this._baseUrl = this._baseUrl.replace(/\/+$/, "")

            if (this._baseUrl) {
                const get_url = `${this._baseUrl}/pipelines/${this._pipelineId}`
                const headers = {
                    'Authorization': await this.authorizationHeader()
                }
                this._requestLogger.debug('before GET %s', get_url)
                let response = await this._client.fetch(get_url, {
                    method: 'GET',
                    headers: headers
                })
                if (response.status > 200) {
                    const message = await response.text()
                    return Promise.reject(`Unexpected status ${response.status}: ${message}`)
                }
                this._requestLogger.debug('after GET %s', get_url)
                this._pipeline = (await response.json()) as Pipeline
            }

            this.updateState()
            return Promise.resolve(this)
        }
    }
    private async authorizationHeader(): Promise<string> {
        return `Bearer ${await this.currentAccessToken()}`;
    }

    private async currentAccessToken(): Promise<string> {
        const now = Date.now() / 1000;
        if (!this._token || <number>this._expire_token_time < now) {
            this.updateState(EndpointState.Authenticating)
            try {
                if (!this._client) {
                    return Promise.reject("endpoint not connected")
                } else if ((this._options.auth as SessionAuth).session !== undefined) {
                    return Promise.reject("temporary access token expired")
                } else if ((this._options.auth as OAuth2Auth).oAuth2 !== undefined &&
                    this._options.eyepopUrl && this._options.popId) {
                    const session = await authenticateBrowserSession(((this._options.auth as OAuth2Auth).oAuth2 as Auth0Options),
                        this._options.eyepopUrl, this._options.popId)
                    this._token = session.accessToken
                    this._expire_token_time = session.validUntil / 1000
                } else if ((this._options.auth as SecretKeyAuth).secretKey !== undefined && this._options.eyepopUrl) {
                    const secretKeyAuth = this._options.auth as SecretKeyAuth
                    const body = {'secret_key': secretKeyAuth.secretKey}
                    const headers = {'Content-Type': 'application/json'}
                    const post_url = `${this.eyepopUrl()}/authentication/token`
                    this._requestLogger.debug('before POST %s', post_url)
                    const response = await this._client.fetch(post_url, {
                        method: 'POST', headers: headers, body: JSON.stringify(body)
                    })
                    if (response.status != 200) {
                        const message = await response.text()
                        return Promise.reject(`Unexpected status ${response.status}: ${message}`)
                    }
                    this._requestLogger.debug('after POST %s', post_url)
                    const data = await response.json()
                    const token: AccessToken = data as AccessToken
                    this._token = token.access_token
                    this._expire_token_time = now + token.expires_in - 60
                } else {
                    return Promise.reject("no valid auth option")
                }
            } finally {
                this.updateState()
            }
        }
        this._logger.debug('using access token, valid for at least %d seconds', <number>this._expire_token_time - now)
        return <string>this._token
    }

    private async startPopLessPipeline() : Promise<string> {
        if (this._client == null || this._baseUrl == null) {
            return Promise.reject("endpoint not initialized")
        }

        this.updateState(EndpointState.StartingPop)

        let pipeline
        if (this._pipeline) {
            pipeline = this._pipeline.inferPipeline
        } else {
            pipeline = 'identity'
        }

        let postTransform
        if (this._pipeline && this._pipeline.postTransform) {
            postTransform = this._pipeline.postTransform
        } else {
            postTransform = null
        }

        const body = {
            'inferPipelineDef': {
                'pipeline': pipeline
            },
            'postTransformDef': {
                'transform': postTransform
            },
            'source': {
                'sourceType': 'NONE',
            },
            'idleTimeoutSeconds': 30,
            'logging': ['out_meta'],
            'videoOutput': 'no_output',
        }

        let post_url
        if (this._sandboxId) {
            post_url = `${this._baseUrl.replace(/\/+$/, "")}/pipelines?sandboxId=${this._sandboxId}`
        } else {
            post_url = `${this._baseUrl.replace(/\/+$/, "")}/pipelines`
        }
        let headers = {
            'Content-Type': 'application/json',
             'Authorization': await this.authorizationHeader()
        }
        this._requestLogger.debug('before POST %s', post_url)
        let response = await this._client.fetch(post_url, {
            method: 'POST', headers: headers, body: JSON.stringify(body)
        })
        if (response.status == 401) {
            this._requestLogger.debug('after GET %s: 401, about to retry with fresh access token', post_url)
            // one retry, the token might have just expired
            this._token = null
            headers = {
                'Content-Type': 'application/json',
                'Authorization': await this.authorizationHeader()
            }
            response = await this._client.fetch(post_url, {
                method: 'POST', headers: headers, body: JSON.stringify(body)
            })
        }

        if (response.status != 200) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        this._requestLogger.debug('after POST %s', post_url)
        const pipelineId = (await response.json())['id']
        return pipelineId
    }
}