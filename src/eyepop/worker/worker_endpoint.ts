import { LocalAuth, SessionAuth } from '../options'
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
    ModelInstanceDef,
    PathSource,
    ResultStream,
    Source,
    SourcesEntry,
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

interface ModelRef {
    id: string
    folderUrl: string
}
interface Pipeline {
    id: string
    startTime: string
    state: string
    pop?: Pop
    inferPipeline: string | null
    modelRefs: ModelRef[] | null
    postTransform: string | null
}

export class WorkerEndpoint extends Endpoint<WorkerEndpoint> {
    private _baseUrl: string | null
    private _pipelineId: string | null
    private _sandboxId: string | null

    private _popName: string | null

    private _pipeline: Pipeline | null

    constructor(options: WorkerOptions) {
        super(options)
        this.setStatusRetryHandlers(new Map<number, Function>([[404, (statusCode: number) => this.statusHandler404(statusCode)]]))
        this._baseUrl = null
        this._pipelineId = null
        this._popName = null
        this._pipeline = null

        this._sandboxId = null
        const sessionAuth: SessionAuth = options.auth as SessionAuth
        if (sessionAuth !== undefined && sessionAuth.session !== undefined) {
            const workerSession = sessionAuth.session as WorkerSession
            if (workerSession.sandboxId) {
                this._sandboxId = workerSession.sandboxId
                this.options().isSandbox = true
            }
        }
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
        if (this._sandboxId && this._baseUrl) {
            const sandboxUrl = `${this._baseUrl}/sandboxes/${this._sandboxId}`
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            let response = await this._client?.fetch(sandboxUrl, {
                method: 'DELETE',
                headers: headers,
            })
            if (response?.status != 204) {
                const message = await response?.text()
                this._logger.info(`disconnecting sandbox failed, status ${response?.status}: ${message}`)
            }
            this._sandboxId = null
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
            sandboxId: this._sandboxId ?? undefined,
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
        }
    }

    private _authenticationHeaders(session: Session): any {
        return (this._options.auth as LocalAuth).isLocal !== undefined ? {} : { Authorization: `Bearer ${session.accessToken}` }
    }

    /**
     * @deprecated use pop() instead
     */
    public popComp(): string | null {
        if (this._pipeline) {
            return this._pipeline.inferPipeline ?? null
        } else {
            return null
        }
    }

    /**
     * @deprecated use changePop() instead
     */
    public async changePopComp(popComp: string, modelRefs: ModelRef[] = []): Promise<void> {
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }

        const body = {
            pipeline: popComp,
            modelRefs: modelRefs,
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            const patch_url = `${session.baseUrl}/pipelines/${session.pipelineId}/inferencePipeline`
            return client.fetch(patch_url, {
                method: 'PATCH',
                body: JSON.stringify(body),
                headers: headers,
            })
        })
        if (response.status != 204) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        if (this._pipeline) {
            this._pipeline.inferPipeline = popComp
            this._pipeline.modelRefs = modelRefs
        }
    }

    /**
     * @deprecated use pop() instead
     */
    public postTransform(): string | null {
        if (this._pipeline) {
            return this._pipeline.postTransform
        } else {
            return null
        }
    }

    /**
     * @deprecated use changePop() instead
     */
    public async changePostTransform(postTransform: string | null): Promise<void> {
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        const body = {
            transform: postTransform,
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            const patch_url = `${session.baseUrl}/pipelines/${session.pipelineId}/postTransform`
            return client.fetch(patch_url, {
                method: 'PATCH',
                body: JSON.stringify(body),
                headers: headers,
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
        if (!this._client) {
            return Promise.reject('endpoint not initialized')
        }
        let config_url
        if (this.options().popId == TransientPopId.Transient) {
            config_url = `${this.eyepopUrl()}/workers/config`
        } else {
            config_url = `${this.eyepopUrl()}/pops/${this.options().popId}/config?auto_start=false`
        }
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
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        let config = (await response.json()) as PopConfig
        if (!config.base_url && this.options().autoStart) {
            const auto_start_config_url = `${this.eyepopUrl()}/pops/${this.options().popId}/config?auto_start=true`
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
            // create a sandbox if needed
            if (this.options().isSandbox && this._sandboxId === null) {
                const headers = {
                    Authorization: await this.authorizationHeader(),
                }
                const createSandboxUrl = `${this._baseUrl}/sandboxes`
                const response = await this._client.fetch(createSandboxUrl, {
                    method: 'POST',
                    headers: headers,
                })

                if (!response.ok) {
                    const message = await response.text()
                    return Promise.reject(`Unexpected status ${response.status}: ${message}`)
                }

                const responseJson = await response.json()

                if (responseJson) {
                    this._sandboxId = responseJson
                }
            }
            if (this.options().popId == TransientPopId.Transient) {
                this._pipelineId = await this.startTransientPipeline()
                this._popName = this.options().popId || null
            } else {
                this._pipelineId = config.pipeline_id
                this._popName = config.name
            }
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
                const body = { sourceType: 'NONE' }
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

        this.updateState()
        return Promise.resolve(this)
    }

    private async startTransientPipeline(): Promise<string> {
        const client = this._client
        const baseUrl = this._baseUrl
        const sandboxId = this._sandboxId

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

        let post_url: string
        if (sandboxId) {
            post_url = `${baseUrl.replace(/\/+$/, '')}/pipelines?sandboxId=${sandboxId}`
        } else {
            post_url = `${baseUrl.replace(/\/+$/, '')}/pipelines`
        }

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

    public async manifest(): Promise<SourcesEntry[]> {
        this._logger.warn('getManifest for development use only')
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        let get_path: string
        if (this._sandboxId === null) {
            get_path = `${baseUrl}/models/sources`
        } else {
            get_path = `${baseUrl}/models/sources?sandboxId=${this._sandboxId}`
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            return client.fetch(get_path, { headers: headers })
        })
        if (!response.ok) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        return (await response.json()) as SourcesEntry[]
    }

    public async models(): Promise<ModelInstanceDef[]> {
        this._logger.warn('listModels for development use only')
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        let get_path: string
        if (this._sandboxId === null) {
            get_path = `${baseUrl}/models/instances`
        } else {
            get_path = `${baseUrl}/models/instances?sandboxId=${this._sandboxId}`
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            return client.fetch(get_path, { headers: headers })
        })
        if (!response.ok) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        const result = (await response.json()) as ModelInstanceDef[]
        return result
    }

    public async changeManifest(manifests: SourcesEntry[]): Promise<void> {
        this._logger.warn('setManifest for development use only')
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        let put_url: string
        if (this._sandboxId === null) {
            put_url = `${baseUrl}/models/sources`
        } else {
            put_url = `${baseUrl}/models/sources?sandboxId=${this._sandboxId}`
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            return client.fetch(put_url, {
                method: 'PUT',
                body: JSON.stringify(manifests),
                headers: headers,
            })
        })
        if (!response.ok) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
    }

    public async loadModel(model: ModelInstanceDef): Promise<ModelInstanceDef> {
        this._logger.warn('loadModel for development use only')
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        let post_url: string
        if (this._sandboxId === null) {
            post_url = `${baseUrl}/models/instances`
        } else {
            post_url = `${baseUrl}/models/instances?sandboxId=${this._sandboxId}`
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            return client.fetch(post_url, {
                method: 'POST',
                body: JSON.stringify(model),
                headers: headers,
            })
        })

        if (!response.ok) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        return (await response.json()) as ModelInstanceDef
    }

    public async unloadModel(modelId: string): Promise<void> {
        this._logger.warn('purgeModel for development use only')
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected, use connect()')
        }
        let delete_url: string
        if (this._sandboxId === null) {
            delete_url = `${baseUrl}/models/instances/${modelId}`
        } else {
            delete_url = `${baseUrl}/models/instances/${modelId}?sandboxId=${this._sandboxId}`
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            let headers = {
                ...this._authenticationHeaders(session),
                'Content-Type': 'application/json',
            }
            return client.fetch(delete_url, { method: 'DELETE', headers: headers })
        })
        if (!response.ok) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
    }
}
