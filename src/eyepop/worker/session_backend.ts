import { LocalAuth, accessTokenCredential, apiKeyCredential, resolveAuth } from '../options'
import { ComputeSessionClient } from '../compute/compute_session'
import type { ResolvedComputeSession } from '../compute/compute_session'
import { EndpointState, Session } from '../types'
import { AbstractJob, LoadFromAssetUuidJob, LoadFromGroupJob, LoadFromJob, LoadMediaStreamJob, UploadGroupJob, UploadJob, UploadSource } from './jobs'
import { resolvePath } from '../shims/local_file'
import { TransientPopId } from './worker_options'
import { WorkerBackend, WorkerContext, WorkerWork } from './worker_backend'
import {
    AssetUuidSource,
    DEFAULT_PREDICTION_VERSION,
    FileSource,
    MediaStreamSource,
    PathSource,
    Pop,
    ProcessParams,
    ResultStream,
    Source,
    StreamSource,
    UrlSource,
    WorkerSession,
} from './worker_types'

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

type ServerErrorFields = { error?: string | undefined; reason?: string | undefined; message?: string | undefined }

/**
 * The worker refused to change a pipeline (HTTP 409): the session's declaration
 * owns it, so a declared stream or a processor runs it, or the session fixes its
 * pop. `error`, `reason` and `serverMessage` are the worker's own fields, when it
 * sent them. Change the declaration rather than the pipeline; sending the same
 * change again is refused again.
 */
export class PipelineManagedError extends Error {
    readonly status: number
    readonly pipelineId: string | undefined
    readonly sessionUuid: string | undefined
    readonly error: string | undefined
    readonly reason: string | undefined
    readonly serverMessage: string | undefined

    constructor(status: number, pipelineId: string | undefined, sessionUuid: string | undefined, fields: ServerErrorFields = {}) {
        const pipeline = `the pipeline ${pipelineId ?? '(unknown)'}${sessionUuid ? ` of session ${sessionUuid}` : ''}`
        const what =
            fields.error == 'pop_fixed'
                ? `${pipeline} runs the session's fixed pop, which cannot be changed through the SDK; change the session's pop instead`
                : `${pipeline} is managed by the session's declaration (a declared stream or processor) and its pop cannot be changed through the SDK; change the declaration instead`
        const server = [fields.error, fields.reason, fields.message].filter(part => !!part).join(': ')
        super(server ? `${what} (${status} ${server})` : `${what} (${status})`)
        this.name = 'PipelineManagedError'
        this.status = status
        this.pipelineId = pipelineId
        this.sessionUuid = sessionUuid
        this.error = fields.error
        this.reason = fields.reason
        this.serverMessage = fields.message
    }

    static async fromResponse(response: Response, pipelineId: string | undefined, sessionUuid: string | undefined): Promise<PipelineManagedError> {
        const body = await response.text()
        let fields: ServerErrorFields = {}
        try {
            const parsed = JSON.parse(body)
            if (parsed && typeof parsed == 'object') {
                const text = (key: string) => (typeof parsed[key] == 'string' && parsed[key].length > 0 ? (parsed[key] as string) : undefined)
                fields = { error: text('error'), reason: text('reason'), message: text('message') }
            }
        } catch (_) {
            fields = body.trim() ? { message: body.trim().slice(0, 300) } : {}
        }
        return new PipelineManagedError(response.status, pipelineId, sessionUuid, fields)
    }
}

function samePop(a: Pop | undefined, b: Pop | undefined): boolean {
    return a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b)
}

/** Runs jobs on a worker session: a compute API session, or a named pop found through its config. */
export class SessionBackend implements WorkerBackend {
    private _baseUrl: string | null = null
    private _pipelineId: string | null = null
    private _popName: string | null = null
    private _sessionAccessToken: string | null = null
    private _sessionAccessTokenValidUntil: number | null = null
    // The account the connected compute session runs under, as compute-api reports it.
    private _accountId: string | undefined = undefined
    // The connected compute session, as compute-api reports it.
    private _sessionUuid: string | undefined = undefined

    private _pipeline: Pipeline | null = null
    private _pipelineCreatePromise: Promise<string> | null = null
    // The pipeline this endpoint started itself (startTransientPipeline), as opposed to one its session came with.
    private _startedPipelineId: string | null = null

    // An upload ignores mediaCacheReencode; the endpoint says so once.
    private _warnedUploadReencode = false

    constructor(private readonly ctx: WorkerContext) {}

    private warnUploadReencode(params: ProcessParams): void {
        if (params.mediaCacheReencode !== undefined && !this._warnedUploadReencode) {
            this._warnedUploadReencode = true
            this.ctx.logger.warn('mediaCacheReencode has no effect for an upload on a worker session; it applies to a url or an asset source')
        }
    }

    public async disconnect(closeEndpoint: () => Promise<void>): Promise<void> {
        await this.deleteOwnPipeline()
        await closeEndpoint()
    }

    /** Local mode: the session is an on-premise instance, reached without credentials. */
    private isLocal(): boolean {
        return (resolveAuth(this.ctx.options) as LocalAuth | undefined)?.isLocal !== undefined
    }

    private async deleteOwnPipeline(): Promise<void> {
        if (this.ctx.options.popId == TransientPopId.Transient && this._pipelineId) {
            await this.deleteTransientPipeline(this._pipelineId)
        }
    }

    /**
     * Whether this endpoint may stop the pipeline. An on-premise instance's pipeline is the instance's: `eyepop
     * instance init` set it up with its pop, and the instance refuses to stop it (409 boot_pipeline). In local mode
     * only one this endpoint started is its to stop.
     */
    private mayStopPipeline(pipelineId: string): boolean {
        return !this.isLocal() || pipelineId === this._startedPipelineId
    }

    public onStatus(statusCode: number): void {
        if (statusCode == 404) {
            this._pipelineId = null
            this._baseUrl = null
        }
    }

    public async session(): Promise<WorkerSession> {
        let session: Session | null = null
        if (this._baseUrl == null) {
            await this.reconnect()
            if (this._baseUrl == null) {
                return Promise.reject('endpoint not connected')
            }
        }
        if (this._sessionAccessToken) {
            session = {
                eyepopUrl: this.ctx.options.eyepopUrl as string,
                accessToken: this._sessionAccessToken,
                validUntil: this._sessionAccessTokenValidUntil || Number.MAX_VALUE,
            }
        } else {
            session = await this.ctx.credentialSession()
        }
        return {
            eyepopUrl: session.eyepopUrl,
            accessToken: session.accessToken,
            validUntil: session.validUntil,
            popId: this.ctx.options.popId as string,
            accountId: this._accountId ?? this.ctx.options.accountId,
            baseUrl: this._baseUrl as string,
            pipelineId: this._pipelineId || undefined,
            isPipelineMode: false,
            authenticationHeaders: () => this._authenticationHeaders(session),
        }
    }

    public popName(): string | null {
        return this._popName
    }

    public pop(): Pop | null {
        if (this._pipeline) {
            return this._pipeline.pop || null
        }
        return this.ctx.options.pop || null
    }

    public async changePop(pop: Pop): Promise<void> {
        if (this.ctx.options.popId == TransientPopId.Transient) {
            await this.changeTransientPop(pop)
            return
        }

        const client = this.ctx.client()
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }

        let pipelineId: string | undefined
        let response = await this.ctx.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                'Content-Type': 'application/json',
                ...this._authenticationHeaders(session),
            }
            pipelineId = session.pipelineId
            const patch_url = `${session.baseUrl}/pipelines/${session.pipelineId}/pop`
            return await client.fetch(patch_url, {
                method: 'PATCH',
                body: JSON.stringify(pop),
                headers: headers,
            })
        })
        if (response.status == 409) {
            throw await PipelineManagedError.fromResponse(response, pipelineId, this._sessionUuid ?? this.ctx.options.sessionUuid)
        }
        if (response.status != 204) {
            const message = await response.text()
            throw new Error(`Unexpected status ${response.status}: ${message}`)
        }
        this.ctx.options.pop = pop
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
        return (resolveAuth(this.ctx.options) as LocalAuth | undefined)?.isLocal !== undefined ? {} : { Authorization: `Bearer ${session.accessToken}` }
    }

    public async submit(work: WorkerWork): Promise<ResultStream> {
        switch (work.kind) {
            case 'source':
                return await this.process(work.source, work.params)
            case 'uploadGroup':
                return await this.uploadGroup(work.paths, work.params)
            case 'uploadStreamGroup':
                return await this.uploadStreamGroup(work.streams, work.mimeTypes, work.params)
            case 'loadFromGroup':
                return await this.loadFromGroup(work.urls, work.params)
        }
    }

    private async process(source: Source, params: ProcessParams): Promise<ResultStream> {
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

    private start(job: AbstractJob): ResultStream {
        job.bindEndpoint(this.ctx.media(), this.ctx.logger)
        return job.start(
            () => {
                this.ctx.jobDone()
            },
            (statusCode: number) => {
                if (statusCode == 404) {
                    this.onStatus(statusCode)
                } else if (statusCode == 401) {
                    this.ctx.forgetCredential()
                }
            },
        )
    }

    private async uploadGroup(paths: string[], params: ProcessParams): Promise<ResultStream> {
        const client = this.ctx.client()
        const limit = this.ctx.limit()
        if (!this._baseUrl || !this._pipelineId || !client) {
            throw new Error('endpoint not connected, use connect()')
        }
        await limit.acquire()
        try {
            this.ctx.updateState()
            const sources: UploadSource[] = await Promise.all(
                paths.map(async (path): Promise<UploadSource> => {
                    const streamSource = await this.resolvePath({ path })
                    return { stream: streamSource.stream, mimeType: streamSource.mimeType }
                }),
            )
            return this.start(new UploadGroupJob(sources, params, async () => this.session(), client, this.ctx.requestLogger, DEFAULT_PREDICTION_VERSION))
        } catch (e) {
            limit.release()
            throw e
        }
    }

    private async uploadStreamGroup(streams: Array<ReadableStream<Uint8Array> | Blob | BufferSource>, mimeTypes: string[] | undefined, params: ProcessParams): Promise<ResultStream> {
        const client = this.ctx.client()
        const limit = this.ctx.limit()
        if (!this._baseUrl || !this._pipelineId || !client) {
            throw new Error('endpoint not connected, use connect()')
        }
        await limit.acquire()
        try {
            this.ctx.updateState()
            const sources: UploadSource[] = streams.map((stream, i) => ({
                stream,
                mimeType: mimeTypes?.[i] ?? null,
            }))
            return this.start(new UploadGroupJob(sources, params, async () => this.session(), client, this.ctx.requestLogger, DEFAULT_PREDICTION_VERSION))
        } catch (e) {
            limit.release()
            throw e
        }
    }

    private async loadFromGroup(urls: string[], params: ProcessParams): Promise<ResultStream> {
        const client = this.ctx.client()
        const limit = this.ctx.limit()
        if (!this._baseUrl || !this._pipelineId || !client) {
            throw new Error('endpoint not connected, use connect()')
        }
        await limit.acquire()
        try {
            this.ctx.updateState()
            return this.start(new LoadFromGroupJob(urls, params, async () => this.session(), client, this.ctx.requestLogger, DEFAULT_PREDICTION_VERSION))
        } catch (e) {
            limit.release()
            throw e
        }
    }

    private async resolvePath(source: PathSource): Promise<StreamSource> {
        if (this.ctx.options.platformSupport?.resolvePath) {
            return await this.ctx.options.platformSupport.resolvePath(source, this.ctx.logger)
        }
        return await resolvePath(source, this.ctx.logger)
    }

    /** Start a job once the transient pipeline runs and a queue permit is held; the permit is released if it cannot start. */
    private async startConnected(makeJob: (client: NonNullable<ReturnType<WorkerContext['client']>>) => Promise<AbstractJob>, rejectsWithText: boolean = false): Promise<ResultStream> {
        await this.ensureTransientPipelineStarted()
        const client = this.ctx.client()
        const limit = this.ctx.limit()
        if (!this._baseUrl || !this._pipelineId || !client) {
            // uploadFile and uploadStream have always rejected with the bare text
            if (rejectsWithText) {
                return Promise.reject('endpoint not connected, use connect()')
            }
            throw new Error('endpoint not connected, use connect()')
        }
        await limit.acquire()
        try {
            this.ctx.updateState()
            return this.start(await makeJob(client))
        } catch (e) {
            // we'll have to reset our queue counter in case the job cannot be started
            limit.release()
            throw e
        }
    }

    private async uploadFile(source: FileSource, params: ProcessParams): Promise<ResultStream> {
        this.warnUploadReencode(params)
        return await this.startConnected(
            async client =>
                new UploadJob(
                    source.file,
                    source.file.type,
                    source.file.size,
                    source.videoMode,
                    params,
                    async () => this.session(),
                    client,
                    this.ctx.requestLogger,
                    undefined,
                    DEFAULT_PREDICTION_VERSION,
                ),
            true,
        )
    }

    private async uploadStream(source: StreamSource, params: ProcessParams): Promise<ResultStream> {
        this.warnUploadReencode(params)
        return await this.startConnected(
            async client =>
                new UploadJob(source.stream, source.mimeType, source.size, source.videoMode, params, async () => this.session(), client, this.ctx.requestLogger, undefined, DEFAULT_PREDICTION_VERSION),
            true,
        )
    }

    private async uploadPath(source: PathSource, params: ProcessParams): Promise<ResultStream> {
        this.warnUploadReencode(params)
        return await this.startConnected(async client => {
            const streamSource = await this.resolvePath(source)
            let firstStreamPending = true
            const uploadBodyFactory = async () => {
                if (firstStreamPending) {
                    firstStreamPending = false
                    return streamSource.stream
                }
                return (await this.resolvePath(source)).stream
            }
            return new UploadJob(
                streamSource.stream,
                streamSource.mimeType,
                streamSource.size,
                source.videoMode,
                params,
                async () => this.session(),
                client,
                this.ctx.requestLogger,
                uploadBodyFactory,
                DEFAULT_PREDICTION_VERSION,
            )
        })
    }

    private async loadFrom(source: UrlSource, params: ProcessParams): Promise<ResultStream> {
        if (source.url.startsWith('file://')) {
            return await this.uploadPath({ path: source.url.substring('file://'.length) }, params)
        }
        return await this.startConnected(async client => new LoadFromJob(source.url, params, async () => this.session(), client, this.ctx.requestLogger, DEFAULT_PREDICTION_VERSION))
    }

    private async loadFromAssetUuid(source: AssetUuidSource, params: ProcessParams): Promise<ResultStream> {
        return await this.startConnected(async client => new LoadFromAssetUuidJob(source.assetUuid, params, async () => this.session(), client, this.ctx.requestLogger, DEFAULT_PREDICTION_VERSION))
    }

    private async loadMediaStream(source: MediaStreamSource, params: ProcessParams): Promise<ResultStream> {
        return await this.startConnected(async client => new LoadMediaStreamJob(source.mediaStream, params, async () => this.session(), client, this.ctx.requestLogger, DEFAULT_PREDICTION_VERSION))
    }

    public async reconnect(): Promise<void> {
        if (this.ctx.options.popId == TransientPopId.Transient) {
            await this.getComputeSession()
            if (this.ctx.options.pop) {
                this.setTransientPipelinePop()
            }
        } else if (this.ctx.options.sessionUuid) {
            await this.getComputeSession()
        } else {
            // TODO remove pop id support in 3.16
            await this.startWebApiSessionWithPopId()
        }
        this.ctx.updateState()
    }

    private async startWebApiSessionWithPopId(): Promise<void> {
        const client = this.ctx.client()
        if (!client) {
            throw new Error('endpoint not initialized')
        }
        const config_url = `${this.ctx.eyepopWebApiUrl()}/pops/${this.ctx.options.popId}/config?auto_start=false`
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        this.ctx.updateState(EndpointState.FetchConfig)
        let response = await client.fetch(config_url, { headers: headers })
        if (response.status == 401) {
            this.ctx.requestLogger.debug('GET %s: 401, about to retry with fresh access token', config_url)
            // one retry, the token might have just expired
            this.ctx.forgetCredential()
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            this.ctx.updateState(EndpointState.FetchConfig)
            response = await client.fetch(config_url, {
                headers: headers,
            })
        }

        if (response.status != 200) {
            const message = await response.text()
            if (response.status == 429) {
                this.ctx.updateState(EndpointState.NotAvailable, message)
            } else {
                this.ctx.updateState(EndpointState.Error, message)
            }
            throw new Error(`Unexpected status ${response.status}: ${message}`)
        }
        let config = (await response.json()) as PopConfig
        if (!config.base_url && this.ctx.options.autoStart) {
            const auto_start_config_url = `${this.ctx.eyepopWebApiUrl()}/pops/${this.ctx.options.popId}/config?auto_start=true`
            this.ctx.requestLogger.debug('pop was not running, trying to autostart with: %s', auto_start_config_url)
            // one retry the pop might just have stopped
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            response = await client.fetch(auto_start_config_url, {
                headers: headers,
            })
            if (response.status != 200) {
                this.ctx.updateState(EndpointState.Error)
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status}: ${message}`)
            }
            config = (await response.json()) as PopConfig
        }

        const baseUrl = new URL(config.base_url, this.ctx.eyepopUrl())
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
            let response = await client.fetch(get_url, {
                method: 'GET',
                headers: headers,
            })
            if (response.status > 200) {
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status}: ${message}`)
            }
            this._pipeline = (await response.json()) as Pipeline

            if (this.ctx.options.stopJobs) {
                const body = { sourceType: 'NONE' }
                const headers = {
                    Authorization: await this.authorizationHeader(),
                    'Content-Type': 'application/json',
                }
                const stop_url = `${this._baseUrl}/pipelines/${this._pipeline.id}/source?mode=preempt&processing=sync`
                let response = await client.fetch(stop_url, {
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

    private static WAIT_FOR_IS_READY: number = 60 * 1000

    private sessionReadyTimeoutMs(): number {
        const seconds = this.ctx.options.sessionReadyTimeoutSeconds
        return typeof seconds == 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : SessionBackend.WAIT_FOR_IS_READY
    }

    private async getComputeSession(): Promise<void> {
        const client = this.ctx.client()
        if (!client) {
            throw new Error('endpoint not initialized')
        }
        let resolved: ResolvedComputeSession
        try {
            resolved = await new ComputeSessionClient({
                computeUrl: this.ctx.eyepopUrl(),
                httpClient: client,
                authorizationHeader: () => this.computeAuthorizationHeader(),
                sessionUuid: this.ctx.options.sessionUuid,
                sessionName: this.ctx.options.sessionName,
                accountId: this.ctx.options.accountId,
                pipelineImage: this.ctx.options.pipelineImage,
                pipelineVersion: this.ctx.options.pipelineVersion,
                pop: this.ctx.options.pop,
                readyTimeoutMs: this.sessionReadyTimeoutMs(),
                logger: this.ctx.logger,
                requestLogger: this.ctx.requestLogger,
            }).resolve()
        } catch (error) {
            this.ctx.updateState(EndpointState.Error)
            throw error
        }
        this._sessionAccessToken = resolved.accessToken
        this._sessionAccessTokenValidUntil = resolved.accessTokenValidUntil
        this._baseUrl = resolved.session.session_endpoint
        this._accountId = resolved.session.account_uuid || undefined
        this._sessionUuid = resolved.session.session_uuid || undefined
        this._pipeline = null
        this._pipelineId = resolved.pipelineId
        if (this.ctx.options.pop) {
            this.setTransientPipelinePop()
        }
    }

    private async startTransientPipeline(): Promise<string> {
        const client = this.ctx.client()
        const baseUrl = this._baseUrl

        if (client == null || baseUrl == null) {
            throw new Error('endpoint not initialized')
        }

        let pop: Pop
        if (this.ctx.options.pop) {
            pop = this.ctx.options.pop as Pop
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

        const response = await this.ctx.fetchWithRetry(async () => {
            let headers = {
                Accept: 'application/json',
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
            throw new Error(`Unexpected status ${response.status} starting transient pipeline: ${message.slice(0, 300)}`)
        }
        const result = await response.json()
        return result['id']
    }

    private async ensureTransientPipelineStarted(): Promise<void> {
        if (this.ctx.options.popId != TransientPopId.Transient || this._pipelineId) {
            return
        }
        if (!this.ctx.options.pop) {
            return
        }
        if (!this._baseUrl) {
            await this.reconnect()
        }
        if (this._pipelineId) {
            return
        }
        if (this.ctx.options.pop) {
            await this.reconnect()
            if (!this._pipelineId) {
                throw new Error('Compute session did not provide a pipeline for the requested pop')
            }
            return
        }
        if (!this._pipelineCreatePromise) {
            this._pipelineCreatePromise = this.startTransientPipeline()
        }
        try {
            this._pipelineId = await this._pipelineCreatePromise
            this._startedPipelineId = this._pipelineId
            this.setTransientPipelinePop()
        } finally {
            this._pipelineCreatePromise = null
        }
    }

    private async changeTransientPop(pop: Pop): Promise<void> {
        if (!this.ctx.client()) {
            throw new Error('endpoint not initialized')
        }
        const previousPop = this.ctx.options.pop
        const previousBaseUrl = this._baseUrl
        const previousSessionAccessToken = this._sessionAccessToken
        const previousSessionAccessTokenValidUntil = this._sessionAccessTokenValidUntil
        const previousPipelineId = this._pipelineId
        if (this._pipelineId) {
            await this.deleteTransientPipeline(this._pipelineId)
            this._pipelineId = null
        }
        this._pipeline = null
        try {
            this.ctx.options.pop = pop
            await this.getComputeSession()
        } catch (error) {
            this.ctx.options.pop = previousPop
            this._pipeline = null
            this._pipelineId = null
            this._baseUrl = previousPop ? null : previousBaseUrl
            this._sessionAccessToken = previousSessionAccessToken
            this._sessionAccessTokenValidUntil = previousSessionAccessTokenValidUntil
            throw error
        }
        if (!this._pipelineId) {
            throw new Error('Compute session did not provide a pipeline for the requested pop')
        }
        if (this.isLocal() && previousPipelineId && this._pipelineId === previousPipelineId && !samePop(pop, previousPop)) {
            // An instance in single-pipeline mode (`eyepop instance init`) answers a session create with its boot
            // pipeline and ignores the pop: the pop did not change. Say so rather than report a pop that is not running.
            this.ctx.options.pop = previousPop
            this._pipeline = null
            this.setTransientPipelinePop()
            throw new PipelineManagedError(409, previousPipelineId, this._sessionUuid ?? this.ctx.options.sessionUuid, {
                error: 'pop_fixed',
                message: 'the on-premise instance kept its own pipeline; its pop is set by `eyepop instance init`',
            })
        }
        if (this.isLocal() && this._pipelineId !== previousPipelineId) {
            // An instance that starts a pipeline per session started this one for this pop change: it is this
            // endpoint's, so disconnect() or the next changePop() stops it.
            this._startedPipelineId = this._pipelineId
        }
        this.setTransientPipelinePop()
    }

    /** Stops a pipeline of the session, unless it is not this endpoint's to stop (mayStopPipeline). */
    private async deleteTransientPipeline(pipelineId: string): Promise<void> {
        const client = this.ctx.client()
        if (!client || !this._baseUrl || !this.mayStopPipeline(pipelineId)) {
            return
        }
        const deleteUrl = `${this._baseUrl}/pipelines/${pipelineId}`
        const headers = {
            Authorization: await this.authorizationHeader(),
        }
        let response = await client.fetch(deleteUrl, {
            method: 'DELETE',
            headers: headers,
        })
        if (response.status >= 300) {
            const message = await response.text()
            this.ctx.logger.info(`stopping pipeline failed, status ${response.status}: ${message}`)
        }
    }

    /** A session's recordings read from its instance, at its root: `{base url}/media` (spec 025). */
    public async mediaBaseUrl(): Promise<string> {
        const session = await this.session()
        if (!session.baseUrl) {
            throw new Error('endpoint not connected, use connect()')
        }
        return `${session.baseUrl.replace(/\/+$/, '')}/media`
    }

    public async mediaHeaders(): Promise<Record<string, string>> {
        return (await this.session()).authenticationHeaders()
    }

    /**
     * A compute session's reads carry the session's own access token, which only compute-api issues: resolve the
     * session again for a fresh one. A pop's session reads under the endpoint's token: forget it.
     */
    public async refreshMediaCredential(): Promise<void> {
        this.ctx.forgetCredential()
        if (this._sessionAccessToken) {
            this._sessionAccessToken = null
            this._sessionAccessTokenValidUntil = null
            await this.reconnect()
        }
    }

    public async authorizationHeader(): Promise<string> {
        if (this._sessionAccessToken) {
            return `Bearer ${this._sessionAccessToken}`
        }
        return this.ctx.credentialHeader()
    }

    private async computeAuthorizationHeader(): Promise<string> {
        const auth = resolveAuth(this.ctx.options)
        if ((auth as LocalAuth | undefined)?.isLocal !== undefined) {
            return 'Implicit'
        }
        const credential = apiKeyCredential(auth) ?? accessTokenCredential(auth)
        if (credential !== undefined) {
            return `Bearer ${credential}`
        }
        return this.ctx.credentialHeader()
    }

    private setTransientPipelinePop(): void {
        const pop = this.ctx.options.pop
        if (pop && this._pipelineId) {
            this._pipeline = {
                id: this._pipelineId,
                state: 'idle',
                startTime: new Date().toString(),
                pop: pop,
            }
        }
    }
}
