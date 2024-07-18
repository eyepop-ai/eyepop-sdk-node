import {WorkerOptions, SessionAuth, TransientPopId} from "./options"
import {
    EndpointState,
    FileSource,
    IngressEvent,
    LiveMedia,
    LiveSource,
    PathSource,
    ResultStream,
    WorkerSession,
    Source,
    SourceParams,
    StreamSource,
    UrlSource
} from "./types"
import {AbstractJob, LoadFromJob, LoadLiveIngressJob, UploadJob} from "./jobs"
import {WebrtcWhip} from "./webrtc_whip"
import {WebrtcWhep} from "./webrtc_whep"
import {resolvePath} from "./shims/local_file"
import {Endpoint} from "./endpoint";


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

interface WsAuthToken {
    token: string;
}

export class WorkerEndpoint extends Endpoint {
    private _baseUrl: string | null
    private _pipelineId: string | null
    private _sandboxId: string | null

    private _popName: string | null

    private _pipeline: Pipeline | null

    private _ingressEventHandler: null | ((event: IngressEvent) => void)
    private _ingressEventWs: WebSocket | null


    constructor(options: WorkerOptions) {
        super(options)
        this.setStatusRetryHandlers(new Map<number, Function>([[404, (statusCode:number) => this.statusHandler404(statusCode)]]))
        this._baseUrl = null
        this._pipelineId = null
        this._popName = null
        this._pipeline = null
        this._ingressEventHandler = null
        this._ingressEventWs = null

        this._sandboxId = null
        const sessionAuth: SessionAuth = (options.auth as SessionAuth)
        if (sessionAuth.session !== undefined) {
            const sessionPlus = (sessionAuth.session as WorkerSession)
            if (sessionPlus.sandboxId) {
                this._sandboxId = sessionPlus.sandboxId
            }
        }
    }

    private options() : WorkerOptions {
        return this._options as WorkerOptions
    }
    public override async connect(): Promise<WorkerEndpoint> {
        await super.connect()
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject("endpoint not connected")
        }

        if (this._baseUrl && this.options().stopJobs) {
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
        return this
    }

    public override onStateChanged(handler: (fromState: EndpointState, toState: EndpointState) => void): WorkerEndpoint {
        super.onStateChanged(handler)
        return this
    }

    protected statusHandler404(statusCode: number): void {
        this._pipelineId = null;
        this._baseUrl = null;
    }

    public override async session(): Promise<WorkerSession> {
        const session = await super.session()
        if (this._baseUrl == null || this._pipelineId == null) {
            await this.reconnect()
            if (this._baseUrl == null || this._pipelineId == null) {
                return Promise.reject("endpoint not connected")
            }
        }
        return {
            eyepopUrl: session.eyepopUrl,
            accessToken: session.accessToken,
            validUntil: session.validUntil,
            popId: this.options().popId as string,
            baseUrl: this._baseUrl as string,
            pipelineId: this._pipelineId as string,
            sandboxId: this._sandboxId?? undefined
        }
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
        return this.options().popId || null
    }

    public onIngressEvent(handler: (event: IngressEvent) => void): Endpoint {
        this._ingressEventHandler = handler
        this.startIngressWs().then(() => {
        }).catch((reason) => {
            this._logger.warn('unexpected error starting the ingress event handler: %s', reason)
        })
        return this
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
            // we'll have to reset our queue counter in case the job cannot be started
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

    private jobStatus(job: AbstractJob, statusCode: number) {
        if (statusCode == 404) {
            this.statusHandler404(statusCode)
        } else if (statusCode == 401) {
            this.statusHandler401(statusCode)
        }
    }

    protected override async reconnect(): Promise<WorkerEndpoint> {
        if (!this._client) {
            return Promise.reject("endpoint not initialized")
        }
        let config_url
        if (this.options().popId == TransientPopId.Transient) {
            config_url = `${this.eyepopUrl()}/workers/config`
        } else {
            config_url = `${this.eyepopUrl()}/pops/${this.options().popId}/config?auto_start=false`
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
            this.statusHandler401(response.status)
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
            if (!config.base_url && this.options().autoStart) {
                const auto_start_config_url = `${this.eyepopUrl()}/pops/${this.options().popId}/config?auto_start=true`
                this._requestLogger.debug('pop was not running, trying to autostart with: %s', auto_start_config_url)
                // one retry the pop might just have stopped
                const headers = {
                    'Authorization': await this.authorizationHeader()
                }
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
            if (this.options().popId == TransientPopId.Transient) {
                this._pipelineId = await this.startPopLessPipeline()
                this._popName = this.options().popId || null
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

    private async startPopLessPipeline() : Promise<string> {
        const client = this._client
        const baseUrl = this._baseUrl
        const sandboxId = this._sandboxId

        if (client == null || baseUrl == null) {
            return Promise.reject("endpoint not initialized")
        }

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
        let response = await this.fetchWithRetry(async () => {
            let post_url
            if (sandboxId) {
                post_url = `${baseUrl.replace(/\/+$/, "")}/pipelines?sandboxId=${sandboxId}`
            } else {
                post_url = `${baseUrl.replace(/\/+$/, "")}/pipelines`
            }
            let headers = {
                'Content-Type': 'application/json',
                 'Authorization': await this.authorizationHeader()
            }
            return client.fetch(post_url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: headers
            })
        })
        if (response.status != 200) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        const pipelineId = (await response.json())['id']
        return pipelineId
    }
}