import { Endpoint } from '../endpoint'
import { WorkerOptions } from '../worker/worker_options'
import { ComponentParams, Pop, ProcessParams, ProcessRequest, ResultStream, Source, WorkerSession, validatePop } from '../worker/worker_types'
import { validateCamera } from '../camera'
import { WorkerBackend, WorkerContext, WorkerWork } from './worker_backend'
import { SessionBackend } from './session_backend'
import { MAX_OPEN_SOURCES, PipelineBackend, PipelineConfigurationError } from './pipeline_backend'

/**
 * Endpoint to an EyePop.ai worker. Its jobs run on a backend: a worker session by default, or with
 * `isPipelineMode` the pipeline API's socket. The methods are the same either way; a backend that
 * cannot honour an option says so.
 */
export class WorkerEndpoint extends Endpoint<WorkerEndpoint> {
    private readonly _backend: WorkerBackend

    constructor(options: WorkerOptions) {
        if (options.isPipelineMode) {
            // A socket takes 256 open sources, so that is the most jobs a pipeline mode endpoint holds;
            // a copy, so that the caller's options are left as they were.
            options = { ...options, jobQueueLength: options.jobQueueLength || MAX_OPEN_SOURCES }
            if ((options.jobQueueLength as number) > MAX_OPEN_SOURCES) {
                throw new PipelineConfigurationError('job_queue_length', `jobQueueLength ${options.jobQueueLength} exceeds ${MAX_OPEN_SOURCES}, the open sources a pipeline API socket takes`)
            }
            if (options.pipelineSockets !== undefined && !(Number.isInteger(options.pipelineSockets) && options.pipelineSockets > 0)) {
                throw new PipelineConfigurationError('pipeline_sockets', `pipelineSockets ${options.pipelineSockets} is not a positive whole number`)
            }
        }
        super(options)
        const context: WorkerContext = {
            options: options,
            logger: this._logger,
            requestLogger: this._requestLogger,
            client: () => this._client,
            limit: () => this._limit,
            jobDone: () => {
                this._limit.release()
                this.updateState()
            },
            updateState: (state, message) => this.updateState(state, message),
            eyepopUrl: () => this.eyepopUrl(),
            eyepopWebApiUrl: () => this.eyepopWebApiUrl(),
            credentialHeader: () => super.authorizationHeader(),
            forgetCredential: () => this.statusHandler401(401),
            fetchWithRetry: (fetcher, retries) => this.fetchWithRetry(fetcher, retries),
            credentialSession: () => super.session(),
        }
        this._backend = options.isPipelineMode ? new PipelineBackend(context) : new SessionBackend(context)
        this.setStatusRetryHandlers(new Map<number, Function>([[404, (statusCode: number) => this._backend.onStatus(statusCode)]]))
    }

    private options(): WorkerOptions {
        return this._options as WorkerOptions
    }

    /** What runs this endpoint's jobs. */
    public backend(): WorkerBackend {
        return this._backend
    }

    public override async disconnect(wait: boolean = true): Promise<void> {
        await this._backend.disconnect(() => super.disconnect(wait))
    }

    public override async session(): Promise<WorkerSession> {
        return await this._backend.session()
    }

    public popName(): string | null {
        return this._backend.popName()
    }

    public pop(): Pop | null {
        return this._backend.pop()
    }

    public async changePop(pop: Pop): Promise<void> {
        // locally, so a Pop that cannot mean what it says fails here rather
        // than as a 400 from the worker that compiles it
        validatePop(pop)
        await this._backend.changePop(pop)
    }

    /**
     * @deprecated Pop ids are only retained for backwards compatibility.
     * Configure transient sessions with `WorkerOptions.pop`.
     */
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
            const request = param1 as ProcessRequest
            this.validateProcessParams(request)
            return await this.submit({ kind: 'source', source: request.source, params: request })
        } else {
            return await this.submit({ kind: 'source', source: param1 as Source, params: { componentParams: param2 } })
        }
    }

    /**
     * Reject a source's calibration before any work is started for it.
     *
     * Called by every entry point that takes ProcessParams, before the
     * concurrency limit is acquired, so a request that can never be sent
     * does not hold a slot.
     */
    private validateProcessParams(params: ProcessParams): void {
        if (params.camera !== undefined) {
            validateCamera(params.camera)
        }
    }

    public async uploadGroup(paths: string[], params: ProcessParams = {}): Promise<ResultStream> {
        if (paths.length === 0) {
            throw new Error('upload group requires at least one path')
        }
        this.validateProcessParams(params)
        return await this.submit({ kind: 'uploadGroup', paths, params })
    }

    public async uploadStreamGroup(streams: Array<ReadableStream<Uint8Array> | Blob | BufferSource>, mimeTypes?: string[], params: ProcessParams = {}): Promise<ResultStream> {
        if (streams.length === 0) {
            throw new Error('upload stream group requires at least one stream')
        }
        if (mimeTypes !== undefined && mimeTypes.length !== streams.length) {
            throw new Error('mimeTypes must have the same length as streams')
        }
        this.validateProcessParams(params)
        return await this.submit({ kind: 'uploadStreamGroup', streams, mimeTypes, params })
    }

    public async loadFromGroup(urls: string[], params: ProcessParams = {}): Promise<ResultStream> {
        if (urls.length === 0) {
            throw new Error('load from group requires at least one url')
        }
        this.validateProcessParams(params)
        return await this.submit({ kind: 'loadFromGroup', urls, params })
    }

    private async submit(work: WorkerWork): Promise<ResultStream> {
        return await this._backend.submit(work)
    }

    protected override async reconnect(): Promise<WorkerEndpoint> {
        await this._backend.reconnect()
        return this
    }

    protected override async authorizationHeader(): Promise<string> {
        return await this._backend.authorizationHeader()
    }
}
