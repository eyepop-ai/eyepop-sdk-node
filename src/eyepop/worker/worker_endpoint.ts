import { LocalAuth } from '../options'
import { EndpointState, Session } from '../types'
import {
    AbstractJob,
    LoadFromAssetUuidJob,
    LoadFromJob,
    LoadMediaStreamJob,
    UploadJob
} from './jobs'
import { resolvePath } from '../shims/local_file'
import { Endpoint } from '../endpoint'
import { TransientPopId, WorkerOptions } from '../worker/worker_options'
import {
    FileSource,
    PathSource,
    ResultStream,
    Source,
    StreamSource,
    UrlSource,
    WorkerSession,
    Pop,
    ComponentParams,
    AssetUuidSource,
    MediaStreamSource,
} from '../worker/worker_types'

interface PopConfig {
    base_url: string
    pipeline_id: string
    name: string
}

interface Pipeline {
    id: string
    startTime: string
    state: string
    pop?: Pop
}

export enum SessionStatus {
    UNKNOWN = "unknown",
    PENDING = "pending",
    RUNNING = "running",
    STOPPED = "stopped",
    FAILED = "failed",
    ERROR = "error",

    PIPELINE_CREATING = "pipeline_creating",
    PIPELINE_OK = "pipeline_ok",
    PIPELINE_CHECKING = "pipeline_checking",
    PIPELINE_ERROR = "pipeline_error",
}

interface ComputeSession {
    session_uuid: string
    session_endpoint: string
    pipeline_uuid: string
    session_status: SessionStatus
    session_message: string
    session_name: string
    user_uuid: string
    created_at: string
    uptime: number
    pipeline_ttl?: number | undefined
    session_active: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class WorkerEndpoint extends Endpoint<WorkerEndpoint> {
    private _baseUrl: string | null
    private _pipelineId: string | null

    private _popName: string | null

    private _pipeline: Pipeline | null

    constructor(options: WorkerOptions) {
        super(options)
        this.setStatusRetryHandlers(new Map<number, Function>([[404, (statusCode: number) => this.statusHandler404(statusCode)]]))
        this._baseUrl = null
        this._pipelineId = null
        this._popName = null
        this._pipeline = null
    }

    private options(): WorkerOptions {
        return this._options as WorkerOptions
    }

    public override async disconnect(wait: boolean = true): Promise<void> {
        if (this.options().popId == TransientPopId.Transient && this._pipelineId) {
            const deleteUrl = `${this._baseUrl}/pipelines/${this._pipelineId}`
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            let response = await this._client?.fetch(deleteUrl, {
                method: 'DELETE',
                headers: headers,
            })
            if (response?.status != 204) {
                const message = await response?.text()
                this._logger.info(`stopping pipeline failed, status ${response?.status}: ${message}`)
            }
        }
        return super.disconnect(wait)
    }

    protected statusHandler404(statusCode: number): void {
        this._pipelineId = null
        this._baseUrl = null
    }

    public override async session(): Promise<WorkerSession> {
        const session = await super.session()
        if (this._baseUrl == null || this._pipelineId == null) {
            await this.reconnect()
            if (this._baseUrl == null || this._pipelineId == null) {
                return Promise.reject('endpoint not connected')
            }
        }
        return {
            eyepopUrl: session.eyepopUrl,
            accessToken: session.accessToken,
            validUntil: session.validUntil,
            popId: this.options().popId as string,
            baseUrl: this._baseUrl as string,
            pipelineId: this._pipelineId as string,
            authenticationHeaders: () => this._authenticationHeaders(session),
        }
    }

    public popName(): string | null {
        return this._popName
    }

    public pop(): Pop | null {
        if (this._pipeline) {
            return this._pipeline.pop || null
        } else {
            return null
        }
    }

    public async changePop(pop: Pop): Promise<void> {
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }

        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                'Content-Type': 'application/json',
                ...this._authenticationHeaders(session),
            }
            const patch_url = `${session.baseUrl}/pipelines/${session.pipelineId}/pop`
            return await client.fetch(patch_url, {
                method: 'PATCH',
                body: JSON.stringify(pop),
                headers: headers,
            })
        })
        if (response.status != 204) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        if (this._pipeline) {
            this._pipeline.pop = pop
        } else {
            this._pipeline = {
                id: this._pipelineId || 'unknown',
                state: "idle",
                startTime: new Date().toString(),
                pop: pop
            }
        }
    }

    private _authenticationHeaders(session: Session): any {
        return (this._options.auth as LocalAuth).isLocal !== undefined ? {} : {Authorization: `Bearer ${session.accessToken}`}
    }

    public popId(): string | null {
        return this.options().popId || null
    }

    public async process(source: Source, params?: ComponentParams[]): Promise<ResultStream> {
        if ((source as FileSource).file !== undefined) {
            return this.uploadFile(source as FileSource, params)
        } else if ((source as StreamSource).stream !== undefined) {
            return this.uploadStream(source as StreamSource, params)
        } else if ((source as PathSource).path !== undefined) {
            return this.uploadPath(source as PathSource, params)
        } else if ((source as UrlSource).url !== undefined) {
            return this.loadFrom(source as UrlSource, params)
        } else if ((source as AssetUuidSource).assetUuid !== undefined) {
            return this.loadFromAssetUuid(source as AssetUuidSource, params)
        } else if ((source as MediaStreamSource).mediaStream !== undefined) {
            return this.loadMediaStream(source as MediaStreamSource, params)
        } else {
            return Promise.reject('unknown source type')
        }
    }

    private async uploadFile(source: FileSource, params: ComponentParams[] | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new UploadJob(
                source.file,
                source.file.type,
                source.file.size,
                source.videoMode,
                params,
                async () => {
                    return this.session()
                },
                this._client,
                this._requestLogger,
            )
            return job.start(
                () => {
                    this.jobDone(job)
                },
                (statusCode: number) => {
                    this.jobStatus(job, statusCode)
                },
            )
        } catch (e) {
            // we'll have to reset our queue counter in case the job cannot be started
            this._limit.release()
            throw e
        }
    }

    private async uploadStream(source: StreamSource, params: ComponentParams[] | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new UploadJob(
                source.stream,
                source.mimeType,
                source.size,
                source.videoMode,
                params,
                async () => {
                    return this.session()
                },
                this._client,
                this._requestLogger,
            )
            return job.start(
                () => {
                    this.jobDone(job)
                },
                (statusCode: number) => {
                    this.jobStatus(job, statusCode)
                },
            )
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async uploadPath(source: PathSource, params: ComponentParams[] | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            let streamSource
            if (this._options.platformSupport?.resolvePath) {
                streamSource = await this._options.platformSupport.resolvePath(source as PathSource, this._logger)
            } else {
                streamSource = await resolvePath(source as PathSource, this._logger)
            }
            const job = new UploadJob(
                streamSource.stream,
                streamSource.mimeType,
                streamSource.size,
                source.videoMode,
                params,
                async () => {
                    return this.session()
                },
                this._client,
                this._requestLogger,
            )
            return job.start(
                () => {
                    this.jobDone(job)
                },
                (statusCode: number) => {
                    this.jobStatus(job, statusCode)
                },
            )
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async loadFrom(source: UrlSource, params: ComponentParams[] | undefined): Promise<ResultStream> {
        if (source.url.startsWith('file://')) {
            return await this.uploadPath({
                path: source.url.substring('file://'.length)
            }, params)
        }
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new LoadFromJob(
                source.url,
                params,
                async () => {
                    return this.session()
                },
                this._client,
                this._requestLogger,
            )
            return job.start(
                () => {
                    this.jobDone(job)
                },
                (statusCode: number) => {
                    this.jobStatus(job, statusCode)
                },
            )
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async loadFromAssetUuid(source: AssetUuidSource, params: ComponentParams[] | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new LoadFromAssetUuidJob(
                source.assetUuid,
                params,
                async () => {
                    return this.session()
                },
                this._client,
                this._requestLogger,
            )
            return job.start(
                () => {
                    this.jobDone(job)
                },
                (statusCode: number) => {
                    this.jobStatus(job, statusCode)
                },
            )
        } catch (e) {
            // we'll have to reset our queue counter in case the job canot be started
            this._limit.release()
            throw e
        }
    }

    private async loadMediaStream(source: MediaStreamSource, params: ComponentParams[] | undefined): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new LoadMediaStreamJob(
                source.mediaStream,
                params,
                async () => {
                    return this.session()
                },
                this._client,
                this._requestLogger,
            )
            return job.start(
                () => {
                    this.jobDone(job)
                },
                (statusCode: number) => {
                    this.jobStatus(job, statusCode)
                },
            )
        } catch (e) {
            // we'll have to reset our queue counter in case the job cannot be started
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
        if (this.options().popId == TransientPopId.Transient) {
            await this.startComputeSession()
            this._pipelineId = await this.startTransientPipeline()
        } else {
            await this.startWebApiSessionWithPopId()
        }
        this.updateState()
        return Promise.resolve(this)
    }

    private async startWebApiSessionWithPopId(): Promise<void> {
        if (!this._client) {
            return Promise.reject('endpoint not initialized')
        }
        let config_url
        config_url = `${this.eyepopWebApiUrl()}/pops/${this.options().popId}/config?auto_start=false`
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        this.updateState(EndpointState.FetchConfig)
        let response = await this._client.fetch(config_url, {headers: headers})
        if (response.status == 401) {
            this._requestLogger.debug('GET %s: 401, about to retry with fresh access token', config_url)
            // one retry, the token might have just expired
            this.statusHandler401(response.status)
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            this.updateState(EndpointState.FetchConfig)
            response = await this._client.fetch(config_url, {
                headers: headers,
            })
        }

        if (response.status != 200) {
            const message = await response.text()
            if (response.status == 429) {
                this.updateState(EndpointState.NotAvailable, message)
            } else {
                this.updateState(EndpointState.Error, message)
            }
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        let config = (await response.json()) as PopConfig
        if (!config.base_url && this.options().autoStart) {
            const auto_start_config_url = `${this.eyepopWebApiUrl()}/pops/${this.options().popId}/config?auto_start=true`
            this._requestLogger.debug('pop was not running, trying to autostart with: %s', auto_start_config_url)
            // one retry the pop might just have stopped
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            response = await this._client.fetch(auto_start_config_url, {
                headers: headers,
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

        if (this._baseUrl) {
            this._baseUrl = this._baseUrl.replace(/\/+$/, '')
            this._pipelineId = config.pipeline_id
            this._popName = config.name
            if (!this._pipelineId || !this._baseUrl) {
                return Promise.reject(`Pop not started`)
            }
            this._baseUrl = this._baseUrl.replace(/\/+$/, '')

            const get_url = `${this._baseUrl}/pipelines/${this._pipelineId}`
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            let response = await this._client.fetch(get_url, {
                method: 'GET',
                headers: headers,
            })
            if (response.status > 200) {
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
            this._pipeline = (await response.json()) as Pipeline

            if (this.options().stopJobs) {
                const body = {sourceType: 'NONE'}
                const headers = {
                    Authorization: await this.authorizationHeader(),
                    "Content-Type": "application/json"
                }
                const stop_url = `${this._baseUrl}/pipelines/${this._pipeline.id}/source?mode=preempt&processing=sync`
                let response = await this._client.fetch(stop_url, {
                    method: 'PATCH',
                    headers: headers,
                    body: JSON.stringify(body),
                })
                if (response.status >= 300) {
                    const message = await response.text()
                    return Promise.reject(`Unexpected status ${response.status}: ${message}`)
                }
            }
        }
    }

    private static SESSION_READY = new Set<SessionStatus>([
        SessionStatus.RUNNING,
        SessionStatus.PIPELINE_CHECKING,
        SessionStatus.PIPELINE_OK
    ])

    private static SESSION_DEAD = new Set<SessionStatus>([
        SessionStatus.ERROR,
        SessionStatus.FAILED,
        SessionStatus.STOPPED,
        SessionStatus.PIPELINE_ERROR,
        SessionStatus.UNKNOWN
    ])

    private static WAIT_FOR_IS_READY: number = 60 * 1000
    private static CHECK_FOR_IS_READY_INTERVAL: number = 250

    private async startComputeSession(): Promise<void> {
        if (!this._client) {
            return Promise.reject('endpoint not initialized')
        }
        let session: ComputeSession | null = null
        const sessionsUrl = `${this.eyepopUrl()}/v1/sessions`
        this._requestLogger.debug('fetching sessions from: %s', sessionsUrl)
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        let response = await this._client.fetch(sessionsUrl, {
            headers: headers,
        })
        let sessions: ComputeSession[]

        if (response.status == 404) {
            sessions = []
        } else if (response.status != 200) {
            this.updateState(EndpointState.Error)
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
        } else {
            const response_content = await response.json()
            sessions = response_content as ComputeSession[]
        }
        if (sessions.length > 0) {
            this._logger.debug(`User has ${sessions.length} sessions, inspecting for active session`)
            for (let s of sessions) {
                if (!WorkerEndpoint.SESSION_DEAD.has(s.session_status)) {
                    session = s
                    this._logger.debug(`Use active session ${s.session_uuid} with pipeline ${s.pipeline_uuid}`)
                    break
                }
            }
        }
        if (!session) {
            this._requestLogger.debug('creating a new session at: %s', sessionsUrl)
            response = await this._client.fetch(sessionsUrl, {
                headers: headers,
                method: 'POST'
            })
            if (response.status != 200) {
                this.updateState(EndpointState.Error)
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status} creating a compute session: ${message}`)
            } else {
                sessions = (await response.json()) as ComputeSession[]
            }
            if (sessions.length == 0) {
                return Promise.reject('Unexpected, no compute session after attempt to create one')
            }
            session = sessions[0]
        }
        let isReady: boolean = false
        const deadline: number = Date.now() + WorkerEndpoint.WAIT_FOR_IS_READY
        while (!isReady) {
            const health_url = `${session.session_endpoint}/health`
            response = await this._client.fetch(health_url, {
                headers: headers,
            })
            if (response.status < 300) {
                isReady = true
            } else if (Date.now() > deadline) {
                return Promise.reject(`Created session ${session.session_uuid} did not become healthy after ${WorkerEndpoint.WAIT_FOR_IS_READY / 1000} seconds`)
            } else {
                this._logger.debug(`session ${session.session_uuid} health check status ${response.status}, wait and poll for update`)
                await sleep(WorkerEndpoint.CHECK_FOR_IS_READY_INTERVAL)
            }
        }
        this._baseUrl = session.session_endpoint
        this._pipeline = null
        if (session.pipeline_uuid) {
            this._pipelineId = session.pipeline_uuid
        } else {
            this._pipelineId = null
        }
    }

    private async startTransientPipeline(): Promise<string> {
        const client = this._client
        const baseUrl = this._baseUrl

        if (client == null || baseUrl == null) {
            return Promise.reject('endpoint not initialized')
        }

        let pop: Pop
        if (this._pipeline && this._pipeline.pop) {
            pop = this._pipeline.pop
        } else {
            pop = {
                components: [],
            }
        }

        const body = {
            pop: pop,
            source: {
                sourceType: 'NONE',
            },
            idleTimeoutSeconds: 30,
            logging: ['out_meta'],
            videoOutput: 'no_output',
        }

        const post_url = `${baseUrl.replace(/\/+$/, '')}/pipelines`

        let response = await this.fetchWithRetry(async () => {
            let headers = {
                'Content-Type': 'application/json',
                Authorization: await this.authorizationHeader(),
            }
            return client.fetch(post_url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: headers,
            })
        })
        if (response.status != 200) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        const result = await response.json()
        return result['id']
    }
}