import { HttpClient, LocalAuth } from '../options'
import { EndpointState, Session } from '../types'
import { AbstractJob, LoadFromAssetUuidJob, LoadFromJob, LoadMediaStreamJob, UploadJob } from './jobs'
import { resolvePath } from '../shims/local_file'
import { Endpoint } from '../endpoint'
import { TransientPopId, WorkerOptions } from '../worker/worker_options'
import {
    AssetUuidSource,
    ComponentParams,
    FileSource,
    MediaStreamSource,
    MotionDetectConfig,
    PathSource,
    Pop,
    ProcessParams,
    ProcessRequest,
    ResultStream,
    Source,
    StreamSource,
    UrlSource,
    WorkerSession,
} from '../worker/worker_types'
import { Area } from 'EyePop/data/data_types'

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
    UNKNOWN = 'unknown',
    PENDING = 'pending',
    RUNNING = 'running',
    STOPPED = 'stopped',
    FAILED = 'failed',
    ERROR = 'error',

    PIPELINE_CREATING = 'pipeline_creating',
    PIPELINE_OK = 'pipeline_ok',
    PIPELINE_CHECKING = 'pipeline_checking',
    PIPELINE_ERROR = 'pipeline_error',
    UPGRADING = 'upgrading',
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
    persistent?: boolean
    pipelines?: { id?: string; pipeline_id?: string }[]
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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

    protected statusHandler404(_: number): void {
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
        if (this.options().popId == TransientPopId.Transient) {
            await this.changeTransientPop(pop)
            return
        }

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
            throw new Error(`Unexpected status ${response.status}: ${message}`)
        }
        this.options().pop = pop
        if (this._pipeline) {
            this._pipeline.pop = pop
        } else {
            this._pipeline = {
                id: this._pipelineId || 'unknown',
                state: 'idle',
                startTime: new Date().toString(),
                pop: pop,
            }
        }
    }

    private _authenticationHeaders(session: Session): any {
        return (this._options.auth as LocalAuth).isLocal !== undefined ? {} : { Authorization: `Bearer ${session.accessToken}` }
    }

    public popId(): string | null {
        return this.options().popId || null
    }

    /**
     * V1 call to process media as a source with optional component params
     *
     * @deprecated use V2 call process() with named parameters
     * @param source
     * @param params
     */
    public async process(source: Source, params?: ComponentParams[]): Promise<ResultStream>

    /**
     * V2 call to process media as a source with extensible named parameters
     *
     * @param source
     * @param componentParams
     * @param motionDetect
     * @param roi
     */
    public async process({ source, componentParams, motionDetect, roi }: ProcessRequest): Promise<ResultStream>

    public async process(param1: any, param2?: any): Promise<ResultStream> {
        if ((param1 as ProcessRequest).source !== undefined) {
            return await this.processV2(param1)
        } else {
            return await this.processV1(param1, param2)
        }
    }

    private async processV1(source: Source, params?: ComponentParams[]): Promise<ResultStream> {
        if ((source as FileSource).file !== undefined) {
            return this.uploadFile(source as FileSource, { componentParams: params })
        } else if ((source as StreamSource).stream !== undefined) {
            return this.uploadStream(source as StreamSource, { componentParams: params })
        } else if ((source as PathSource).path !== undefined) {
            return this.uploadPath(source as PathSource, { componentParams: params })
        } else if ((source as UrlSource).url !== undefined) {
            return this.loadFrom(source as UrlSource, { componentParams: params })
        } else if ((source as AssetUuidSource).assetUuid !== undefined) {
            return this.loadFromAssetUuid(source as AssetUuidSource, { componentParams: params })
        } else if ((source as MediaStreamSource).mediaStream !== undefined) {
            return this.loadMediaStream(source as MediaStreamSource, { componentParams: params })
        } else {
            return Promise.reject('unknown source type')
        }
    }

    private async processV2(request: ProcessRequest): Promise<ResultStream> {
        if ((request.source as FileSource).file !== undefined) {
            return this.uploadFile(request.source as FileSource, request)
        } else if ((request.source as StreamSource).stream !== undefined) {
            return this.uploadStream(request.source as StreamSource, request)
        } else if ((request.source as PathSource).path !== undefined) {
            return this.uploadPath(request.source as PathSource, request)
        } else if ((request.source as UrlSource).url !== undefined) {
            return this.loadFrom(request.source as UrlSource, request)
        } else if ((request.source as AssetUuidSource).assetUuid !== undefined) {
            return this.loadFromAssetUuid(request.source as AssetUuidSource, request)
        } else if ((request.source as MediaStreamSource).mediaStream !== undefined) {
            return this.loadMediaStream(request.source as MediaStreamSource, request)
        } else {
            return Promise.reject('unknown source type')
        }
    }

    private async uploadFile(source: FileSource, params: ProcessParams): Promise<ResultStream> {
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

    private async uploadStream(source: StreamSource, params: ProcessParams): Promise<ResultStream> {
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

    private async uploadPath(source: PathSource, params: ProcessParams): Promise<ResultStream> {
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

    private async loadFrom(source: UrlSource, params: ProcessParams): Promise<ResultStream> {
        if (source.url.startsWith('file://')) {
            return await this.uploadPath(
                {
                    path: source.url.substring('file://'.length),
                },
                params,
            )
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

    private async loadFromAssetUuid(source: AssetUuidSource, params: ProcessParams): Promise<ResultStream> {
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

    private async loadMediaStream(source: MediaStreamSource, params: ProcessParams): Promise<ResultStream> {
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

    private jobDone(_: AbstractJob) {
        this._limit?.release()
        this.updateState()
    }

    private jobStatus(_: AbstractJob, statusCode: number) {
        if (statusCode == 404) {
            this.statusHandler404(statusCode)
        } else if (statusCode == 401) {
            this.statusHandler401(statusCode)
        }
    }

    protected override async reconnect(): Promise<WorkerEndpoint> {
        if (this.options().popId == TransientPopId.Transient) {
            await this.getComputeSession()
            if (!this._pipelineId && this.options().pop) {
                this._pipelineId = await this.startTransientPipeline()
            }
            this.setTransientPipelinePop()
        } else if (this.options().sessionUuid) {
            await this.getComputeSession()
        } else {
            // TDOD remove pop id support in 3.16
            await this.startWebApiSessionWithPopId()
        }
        this.updateState()
        return Promise.resolve(this)
    }

    private async startWebApiSessionWithPopId(): Promise<void> {
        if (!this._client) {
            throw new Error('endpoint not initialized')
        }
        const config_url = `${this.eyepopWebApiUrl()}/pops/${this.options().popId}/config?auto_start=false`
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        this.updateState(EndpointState.FetchConfig)
        let response = await this._client.fetch(config_url, { headers: headers })
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
            throw new Error(`Unexpected status ${response.status}: ${message}`)
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
                throw new Error(`Unexpected status ${response.status}: ${message}`)
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
                throw new Error('Pop not started')
            }

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
                throw new Error(`Unexpected status ${response.status}: ${message}`)
            }
            this._pipeline = (await response.json()) as Pipeline

            if (this.options().stopJobs) {
                const body = { sourceType: 'NONE' }
                const headers = {
                    Authorization: await this.authorizationHeader(),
                    'Content-Type': 'application/json',
                }
                const stop_url = `${this._baseUrl}/pipelines/${this._pipeline.id}/source?mode=preempt&processing=sync`
                let response = await this._client.fetch(stop_url, {
                    method: 'PATCH',
                    headers: headers,
                    body: JSON.stringify(body),
                })
                if (response.status >= 300) {
                    const message = await response.text()
                    throw new Error(`Unexpected status ${response.status}: ${message}`)
                }
            }
        }
    }

    private static SESSION_DEAD = new Set<SessionStatus>([SessionStatus.ERROR, SessionStatus.FAILED, SessionStatus.STOPPED, SessionStatus.PIPELINE_ERROR, SessionStatus.UNKNOWN])
    private static PIPELINE_PENDING = new Set<SessionStatus>([SessionStatus.PENDING, SessionStatus.PIPELINE_CREATING, SessionStatus.PIPELINE_CHECKING, SessionStatus.UPGRADING])

    private static WAIT_FOR_IS_READY: number = 10 * 60 * 1000
    private static CHECK_FOR_IS_READY_INTERVAL: number = 250

    private async getComputeSession(): Promise<void> {
        if (!this._client) {
            throw new Error('endpoint not initialized')
        }
        let session: ComputeSession
        let headers: any
        const sessionUuid = this.options().sessionUuid
        if (sessionUuid) {
            ;[session, headers] = await this.getPermanentComputeSession(this._client, sessionUuid)
        } else {
            ;[session, headers] = await this.getOnDemandComputeSession(this._client)
        }
        let isReady: boolean = false
        const deadline: number = Date.now() + WorkerEndpoint.WAIT_FOR_IS_READY
        while (!isReady) {
            const health_url = `${session.session_endpoint}/health`
            const response = await this._client.fetch(health_url, {
                headers: headers,
            })
            if (response.status < 300) {
                isReady = true
            } else if (Date.now() > deadline) {
                throw new Error(`Created session ${session.session_uuid} did not become healthy after ${WorkerEndpoint.WAIT_FOR_IS_READY / 1000} seconds`)
            } else {
                this._logger.debug(`session ${session.session_uuid} health check status ${response.status}, wait and poll for update`)
                await sleep(WorkerEndpoint.CHECK_FOR_IS_READY_INTERVAL)
            }
        }
        if (this.options().pop && !this.pipelineIdFromSession(session)) {
            session = await this.waitForComputeSessionPipeline(session, headers, deadline)
        }
        this._baseUrl = session.session_endpoint
        this._pipeline = null
        this._pipelineId = this.pipelineIdFromSession(session)
        if (this.options().pop && !this._pipelineId) {
            this._pipelineId = await this.startTransientPipeline()
        }
        if (this.options().pop) {
            this.setTransientPipelinePop()
        }
    }

    private async getOnDemandComputeSession(httpClient: HttpClient): Promise<[ComputeSession, any]> {
        let session: ComputeSession | null = null

        const sessionsUrl = `${this.eyepopUrl()}/v1/sessions`
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        let sessions: ComputeSession[]

        if (!this.options().pop) {
            this._requestLogger.debug('fetching sessions from: %s', sessionsUrl)
            const response = await httpClient.fetch(sessionsUrl, {
                headers: headers,
            })

            if (response.status == 404) {
                sessions = []
            } else if (response.status != 200) {
                this.updateState(EndpointState.Error)
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
            } else {
                const response_content = await response.json()
                sessions = response_content as ComputeSession[]
            }
            if (sessions.length > 0) {
                this._logger.debug(`User has ${sessions.length} sessions, inspecting for usable session`)
                for (let s of sessions) {
                    if (!WorkerEndpoint.SESSION_DEAD.has(s.session_status) && !s.persistent) {
                        session = s
                        this._logger.debug(`Use active session ${s.session_uuid} with pipeline ${this.pipelineIdFromSession(s)}`)
                        break
                    }
                }
            }
        }
        if (!session) {
            this._requestLogger.debug('creating a new session at: %s', sessionsUrl)
            const createBody = this.sessionCreateBody()
            const createHeaders = {
                ...headers,
                ...(createBody ? { 'Content-Type': 'application/json' } : {}),
            }
            const request: RequestInit = {
                headers: createHeaders,
                method: 'POST',
            }
            if (createBody) {
                request.body = createBody
            }
            const response = await httpClient.fetch(`${sessionsUrl}?wait=true`, request)
            if (response.status != 200) {
                this.updateState(EndpointState.Error)
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status} creating a compute session: ${message}`)
            } else {
                sessions = (await response.json()) as ComputeSession[]
            }
            if (sessions.length == 0) {
                throw new Error('Unexpected, no compute session after attempt to create one')
            }
            session = sessions[0] || null
        }
        if (!session) {
            throw new Error('unexpected undefined session')
        }
        return [session, headers]
    }

    private async getPermanentComputeSession(httpClient: HttpClient, sessionUuid: string): Promise<[ComputeSession, any]> {
        let session: ComputeSession | null = null

        const sessionUrl = `${this.eyepopUrl()}/v1/sessions/${sessionUuid}`
        this._requestLogger.debug('fetching session from: %s', sessionUrl)
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        let response = await httpClient.fetch(sessionUrl, {
            headers: headers,
        })
        if (response.status == 404) {
            this.updateState(EndpointState.Error)
            throw new Error(`Unexpected status ${response.status} compute sessions ${sessionUuid} not found`)
        } else if (response.status != 200) {
            this.updateState(EndpointState.Error)
            const message = await response.text()
            throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
        } else {
            const response_content = await response.json()
            session = response_content as ComputeSession
        }
        return [session, headers]
    }

    private async waitForComputeSessionPipeline(session: ComputeSession, headers: any, deadline: number): Promise<ComputeSession> {
        if (!this._client) {
            throw new Error('endpoint not initialized')
        }
        let latest = session
        while (!this.pipelineIdFromSession(latest)) {
            if (WorkerEndpoint.SESSION_DEAD.has(latest.session_status)) {
                throw new Error(`Session ${latest.session_uuid} entered terminal status ${latest.session_status}: ${latest.session_message || ''}`)
            }
            if (!WorkerEndpoint.PIPELINE_PENDING.has(latest.session_status) && latest.session_status !== SessionStatus.RUNNING) {
                this._logger.debug(`session ${latest.session_uuid} status ${latest.session_status}, wait and poll for pipeline`)
            }
            if (Date.now() > deadline) {
                throw new Error(`Created session ${latest.session_uuid} did not report a pipeline after ${WorkerEndpoint.WAIT_FOR_IS_READY / 1000} seconds`)
            }
            await sleep(WorkerEndpoint.CHECK_FOR_IS_READY_INTERVAL)
            const sessionUrl = `${this.eyepopUrl()}/v1/sessions/${latest.session_uuid}`
            const response = await this._client.fetch(sessionUrl, {
                headers: headers,
            })
            if (response.status == 404) {
                this._logger.debug(`session ${latest.session_uuid} not found while polling compute, falling back to worker pipeline creation`)
                return latest
            }
            if (response.status != 200) {
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status} polling compute session: ${message}`)
            }
            latest = (await response.json()) as ComputeSession
        }
        return latest
    }

    private async startTransientPipeline(): Promise<string> {
        const client = this._client
        const baseUrl = this._baseUrl

        if (client == null || baseUrl == null) {
            throw new Error('endpoint not initialized')
        }

        let pop: Pop
        if (this.options().pop) {
            pop = this.options().pop as Pop
        } else if (this._pipeline && this._pipeline.pop) {
            pop = this._pipeline.pop
        } else {
            throw new Error('Cannot start a transient pipeline without a pop')
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

        const response = await this.fetchWithRetry(async () => {
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
            throw new Error(`Unexpected status ${response.status}: ${message}`)
        }
        const result = await response.json()
        return result['id']
    }

    private async changeTransientPop(pop: Pop): Promise<void> {
        if (!this._client) {
            throw new Error('endpoint not initialized')
        }
        const previousPop = this.options().pop
        if (this._pipelineId) {
            await this.deleteTransientPipeline(this._pipelineId)
            this._pipelineId = null
        }
        this._pipeline = null
        try {
            this.options().pop = pop
            await this.getComputeSession()
        } catch (error) {
            this.options().pop = previousPop
            throw error
        }
        if (!this._pipelineId) {
            throw new Error('Compute session did not provide a pipeline for the requested pop')
        }
        this.setTransientPipelinePop()
    }

    private async deleteTransientPipeline(pipelineId: string): Promise<void> {
        if (!this._client || !this._baseUrl) {
            return
        }
        const deleteUrl = `${this._baseUrl}/pipelines/${pipelineId}`
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        let response = await this._client.fetch(deleteUrl, {
            method: 'DELETE',
            headers: headers,
        })
        if (response.status >= 300) {
            const message = await response.text()
            this._logger.info(`stopping pipeline failed, status ${response.status}: ${message}`)
        }
    }

    private pipelineIdFromSession(session: ComputeSession): string | null {
        if (session.pipeline_uuid) {
            return session.pipeline_uuid
        }
        const pipeline = session.pipelines?.[0]
        return pipeline?.id || pipeline?.pipeline_id || null
    }

    private setTransientPipelinePop(): void {
        const pop = this.options().pop
        if (pop && this._pipelineId) {
            this._pipeline = {
                id: this._pipelineId,
                state: 'idle',
                startTime: new Date().toString(),
                pop: pop,
            }
        }
    }

    private sessionCreateBody(): string | undefined {
        const body: any = {}
        if (this.options().sessionName) {
            body.session_name = this.options().sessionName
        }
        if (this.options().pipelineImage) {
            body.pipeline_image = this.options().pipelineImage
        }
        if (this.options().pipelineVersion) {
            body.pipeline_version = this.options().pipelineVersion
        }
        if (this.options().pop) {
            body.pop = this.options().pop
        }
        return Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
    }
}
