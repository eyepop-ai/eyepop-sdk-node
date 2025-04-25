import { SessionAuth } from '../options'
import { EndpointState } from '../types'
import { createWebSocket } from '../shims/websockets'
import { Endpoint } from '../endpoint'
import urljoin from 'url-join'
import { DataOptions } from './data_options'
import {
    Annotation,
    Asset,
    AssetImport,
    AutoAnnotateParams,
    ChangeEvent,
    ChangeType,
    DataSession,
    Dataset,
    DatasetCreate,
    DatasetHeroAssetUpdate,
    DatasetUpdate,
    ExportedBy,
    Model,
    ModelCreate,
    ModelTrainingProgress,
    ModelUpdate,
    OnChangeEvent,
    QcAiHubExportParams,
    TranscodeMode,
    UserReview,
    ArtifactType, CreateWorkflow, Workflow,
    WorkflowPhase,
    ListWorkFlowItem
} from './data_types'
import { Prediction } from '@eyepop.ai/eyepop'
import { ModelFormat } from '../worker/worker_types'

interface DataConfig {
    base_url: string
}

const WS_INITIAL_RECONNECT_DELAY = 1000
const WS_MAX_RECONNECT_DELAY = 60000

export class DataEndpoint extends Endpoint<DataEndpoint> {
    private _baseUrl: string | null
    private _accountId: string | null

    private _ws: WebSocket | null
    private _ws_current_reconnect_delay: number | null

    private _account_event_handlers: OnChangeEvent[]
    private _dataset_uuid_to_event_handlers: Map<string, OnChangeEvent[]>

    constructor(options: DataOptions) {
        super(options)
        this._baseUrl = null
        this._ws = null
        this._ws_current_reconnect_delay = null
        this._accountId = options.accountId || null
        this._account_event_handlers = []
        this._dataset_uuid_to_event_handlers = new Map<string, OnChangeEvent[]>()
        const sessionAuth: SessionAuth = options.auth as SessionAuth
        if (sessionAuth.session !== undefined) {
            const dataSession = sessionAuth.session as DataSession
            if (dataSession.accountId) {
                this._accountId = dataSession.accountId
            }
        }
    }

    public override async session(): Promise<DataSession> {
        const session = await super.session()
        return {
            eyepopUrl: session.eyepopUrl,
            accessToken: session.accessToken,
            validUntil: session.validUntil,
            accountId: this.options().accountId as string,
            baseUrl: this._baseUrl as string,
        }
    }

    public override async disconnect(wait: boolean = true): Promise<void> {
        this._baseUrl = null
        if (this._ws) {
            try {
                this._ws.close()
            } catch (e) {
                this._logger.warn('ignored exception', e)
            }
            this._ws = null
        }
        await super.disconnect(wait)
    }

    protected override async reconnect(): Promise<DataEndpoint> {
        if (!this._client) {
            return Promise.reject('endpoint not initialized')
        }
        const config_url = `${this.eyepopUrl()}/data/config?account_uuid=${this._accountId}`
        let headers = {
            Authorization: await this.authorizationHeader(),
        }
        this.updateState(EndpointState.FetchConfig)
        let response = await this._client.fetch(config_url, { headers: headers })
        if (response.status == 401) {
            this._requestLogger.debug('GET %s: 401, about to retry with fresh access token', config_url)
            // one retry, the token might have just expired
            this.statusHandler401(response.status)
            headers = {
                Authorization: await this.authorizationHeader(),
            }
            this.updateState(EndpointState.FetchConfig)
            response = await this._client.fetch(config_url, {
                headers: headers,
            })
        }

        if (response.status != 200) {
            this.updateState(EndpointState.Error)
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        let config = (await response.json()) as DataConfig
        const baseUrl = new URL(config.base_url, this.eyepopUrl())
        this._baseUrl = baseUrl.toString()

        if (this.options().disableWs) {
            this._logger.info('disabled ws connection')
        } else {
            await this.reconnect_ws()
        }

        if (this.options().useCookie) {
            const client = this._client
            const url = urljoin(this._baseUrl, 'security', 'check?set_cookie=true')
            const headers = {
                Authorization: await this.authorizationHeader(),
            }
            response = await client.fetch(url, {
                headers: headers,
            })
            if (response.status != 204) {
                this.updateState(EndpointState.Error)
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
        }

        this.updateState()
        return Promise.resolve(this)
    }

    private async reconnect_ws(): Promise<void> {
        if (this._ws) {
            this._ws.close()
            this._ws = null
        }
        const baseUrl = this._baseUrl?.replace('https://', 'wss://').replace('http://', 'ws://')
        if (!baseUrl) {
            return
        }
        const ws_url = urljoin(baseUrl, 'events')
        this._requestLogger.debug('about to connect ws to: %s', ws_url)
        return new Promise((resolve, reject) => {
            const ws = createWebSocket(ws_url)
            if (!ws) {
                return resolve()
            }
            this._ws = ws

            ws.onopen = async () => {
                const auth_header = await this.authorizationHeader()
                let msg = JSON.stringify({ authorization: auth_header })
                this._requestLogger.debug('ws send: %s', msg)
                ws.send(msg)
                msg = JSON.stringify({ subscribe: { account_uuid: this._accountId } })
                this._requestLogger.debug('ws send: %s', msg)
                ws.send(msg)
                for (let dataset_uuid in this._dataset_uuid_to_event_handlers.keys()) {
                    const msg = JSON.stringify({ subscribe: { dataset_uuid: dataset_uuid } })
                    this._requestLogger.debug('ws send: %s', msg)
                    ws.send(msg)
                }
                this._ws_current_reconnect_delay = WS_INITIAL_RECONNECT_DELAY
                resolve()
            }

            ws.onmessage = event => {
                const data = JSON.parse(event.data)
                this._requestLogger.debug('received ws: %s', JSON.stringify(data))
                const change_event = data as ChangeEvent
                this.dispatchChangeEvent(change_event)
            }

            ws.onclose = (event: CloseEvent) => {
                const { code, reason } = event
                this._requestLogger.debug('ws closed: %d %s', code, reason)

                if (reason !== 'unsubscribe') {
                    if (!this._ws_current_reconnect_delay) {
                        this._ws_current_reconnect_delay = WS_INITIAL_RECONNECT_DELAY
                    } else if (this._ws_current_reconnect_delay < WS_MAX_RECONNECT_DELAY) {
                        this._ws_current_reconnect_delay *= 1.5
                    }
                    setTimeout(async () => {
                        await this.reconnect_ws()
                    }, this._ws_current_reconnect_delay)
                }
            }

            ws.onerror = (event: Event): any => {
                this._logger.error(event)
                reject(event)
                return null
            }
        })
    }

    private options(): DataOptions {
        return this._options as DataOptions
    }

    private async request(path: string, options: RequestInit = {}, disableAuth: boolean = false) {
        const client = this._client
        const baseUrl = this._baseUrl
        if (!baseUrl || !client) {
            return Promise.reject('endpoint not connected')
        }

        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            const headers = {
                'Content-Type': 'application/json',
                ...(disableAuth ? {} : { Authorization: `Bearer ${session.accessToken}` }),
                ...(options.headers || {}),
            }

            if (!options.body) {
                options.body = null
            }

            const ri = {
                headers: headers,
                method: options.method || 'GET',
                body: options.body,
            }

            this._requestLogger.debug('Request - ' + ri.method + path + ' BODY: ' + (ri.body ? ri.body : ''))

            return await client.fetch(urljoin(session.baseUrl ?? '', path), ri)
        })

        if (response.status === 204) {
            return null // Return null if the response is completely empty
        }

        const contentType = response.headers.get('Content-Type')
        this._requestLogger.debug('Response - ' + response.status + ' ' + response.statusText)

        if (!response.ok) {
            if (contentType && (contentType.toLowerCase().startsWith('application/json') || contentType.toLowerCase().startsWith('text/'))) {
                throw new Error(`Request failed with ${response.status} ${response.statusText}: ${await response.text()}`)
            } else {
                throw new Error(`Request failed with ${response.status} ${response.statusText}`)
            }
        }

        if (contentType && contentType.toLowerCase().startsWith('application/json')) {
            return await response.json()
        }

        return await response.blob()
    }

    async listDatasets(include_stats: boolean = true, modifiable_version_only?: boolean): Promise<Dataset[]> {
        const modifiableVersionQuery = typeof modifiable_version_only !== 'undefined' ? `&modifiable_version_only=${modifiable_version_only}` : ''
        return this.request(`/datasets?account_uuid=${this._accountId}&include_stats=${include_stats}${modifiableVersionQuery}`, {
            method: 'GET',
        })
    }

    async createDataset(data: DatasetCreate): Promise<Dataset> {
        return this.request(`/datasets?account_uuid=${this._accountId}`, {
            method: 'POST',
            body: JSON.stringify(data),
        })
    }

    async getDataset(dataset_uuid: string, include_stats: boolean = true, dataset_version?: number, modifiable_version_only?: boolean): Promise<Dataset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const modifiableVersionQuery = typeof modifiable_version_only !== 'undefined' ? `&modifiable_version_only=${modifiable_version_only}` : ''
        return this.request(`/datasets/${dataset_uuid}?include_stats=${include_stats}${versionQuery}${modifiableVersionQuery}`, {
            method: 'GET',
        })
    }

    async updateDataset(dataset_uuid: string, data: DatasetUpdate, start_auto_annotate: boolean = true): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}?start_auto_annotate=${start_auto_annotate}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        })
    }

    async updateDatasetHeroAsset(dataset_uuid: string, update: DatasetHeroAssetUpdate): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}/hero_asset`, {
            method: 'PATCH',
            body: JSON.stringify(update),
        })
    }

    async deleteDataset(dataset_uuid: string): Promise<void> {
        return this.request(`/datasets/${dataset_uuid}`, {
            method: 'DELETE',
        })
    }

    async freezeDatasetVersion(dataset_uuid: string, dataset_version?: number): Promise<Dataset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        return this.request(`/datasets/${dataset_uuid}/freeze?${versionQuery}`, {
            method: 'POST',
        })
    }

    async analyzeDatasetVersion(dataset_uuid: string, dataset_version?: number): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        return this.request(`/datasets/${dataset_uuid}/analyze?${versionQuery}`, {
            method: 'POST',
        })
    }

    async autoAnnotateDatasetVersion(dataset_uuid: string, dataset_version?: number, max_assets?: number): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const maxAssetsQuery = max_assets ? `&max_assets=${max_assets}` : ''
        return this.request(`/datasets/${dataset_uuid}/auto_annotate?${versionQuery}${maxAssetsQuery}`, {
            method: 'POST',
        })
    }

    async deleteDatasetVersion(dataset_uuid: string, dataset_version: number): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}/versions?dataset_version=${dataset_version}`, {
            method: 'DELETE',
        })
    }

    async deleteAnnotations(dataset_uuid: string, dataset_version: number, user_reviews: UserReview[] = [UserReview.unknown]): Promise<void> {
        let userReviewsQuery = ''
        for (let userReview in user_reviews) {
            userReviewsQuery += `&user_review=${userReview}`
        }
        await this.request(`/datasets/${dataset_uuid}/annotations?dataset_version=${dataset_version}${userReviewsQuery}`, {
            method: 'DELETE',
        })
    }

    // Asset methods
    async uploadAsset(dataset_uuid: string, dataset_version: number | undefined, blob: Blob, external_id: string | undefined = undefined): Promise<Asset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        let post_path: string
        if (external_id) {
            post_path = `/assets?dataset_uuid=${dataset_uuid}${versionQuery}&external_id=${external_id}`
        } else {
            post_path = `/assets?dataset_uuid=${dataset_uuid}${versionQuery}`
        }

        return this.request(post_path, {
            method: 'POST',
            body: blob,
            headers: {
                'Content-Type': blob.type || 'application/octet-stream',
            },
        })
    }

    async importAsset(dataset_uuid: string, dataset_version: number | undefined, asset_import: AssetImport, external_id: string | undefined = undefined): Promise<Asset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        let post_path: string
        if (external_id) {
            post_path = `/assets/imports?dataset_uuid=${dataset_uuid}${versionQuery}&external_id=${external_id}`
        } else {
            post_path = `/assets/imports?dataset_uuid=${dataset_uuid}${versionQuery}`
        }

        return this.request(post_path, {
            method: 'POST',
            body: JSON.stringify(asset_import),
            headers: {
                'Content-Type': 'application/json',
            },
        })
    }

    async listAssets(dataset_uuid: string, dataset_version?: number, include_annotations: boolean = false, top_k?: number): Promise<Asset[]> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const annotationsQuery = include_annotations ? '&include_annotations=true' : ''
        const topKQuery = top_k ? `&top_k=${top_k}` : ''
        return this.request(`/assets?dataset_uuid=${dataset_uuid}${versionQuery}${annotationsQuery}${topKQuery}`, {
            method: 'GET',
        })
    }

    async getAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, include_annotations: boolean = false, top_k?: number): Promise<Asset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const annotationsQuery = include_annotations ? '&include_annotations=true' : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        const topKQuery = top_k ? `&top_k=${top_k}` : ''
        return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}${annotationsQuery}${topKQuery}`, {
            method: 'GET',
        })
    }

    async deleteAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}`, {
            method: 'DELETE',
        })
    }

    async resurrectAsset(asset_uuid: string, dataset_uuid: string, from_dataset_version: number, into_dataset_version?: number): Promise<void> {
        const intoVersionQuery = into_dataset_version ? `&into_dataset_version=${into_dataset_version}` : ''
        return this.request(`/assets/${asset_uuid}/resurrect?dataset_uuid=${dataset_uuid}&from_dataset_version=${from_dataset_version}${intoVersionQuery}`, {
            method: 'POST',
        })
    }

    async updateAssetGroundTruth(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, prediction?: Prediction): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        return this.request(`/assets/${asset_uuid}/ground_truth?${datasetQuery}${versionQuery}`, {
            method: 'PATCH',
            body: JSON.stringify(prediction),
        })
    }

    async deleteAssetGroundTruth(asset_uuid: string, dataset_uuid?: string, dataset_version?: number): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        return this.request(`/assets/${asset_uuid}/ground_truth?${datasetQuery}${versionQuery}`, {
            method: 'DELETE',
        })
    }

    async updateAutoAnnotationStatus(asset_uuid: string, auto_annotate: string, user_review: UserReview, approved_threshold?: number): Promise<void> {
        const validStatuses = ['approved', 'rejected', 'unknown']
        if (!validStatuses.includes(user_review)) {
            throw new Error('Invalid status')
        }
        const thresholdQuery = approved_threshold ? `?approved_threshold=${approved_threshold}` : ''
        return this.request(`/assets/${asset_uuid}/auto_annotations/${auto_annotate}/user_review/${user_review}${thresholdQuery}`, {
            method: 'PATCH',
        })
    }

    async downloadAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, transcode_mode: TranscodeMode = TranscodeMode.original): Promise<Blob> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        return this.request(`/assets/${asset_uuid}/download?${datasetQuery}${versionQuery}&transcode_mode=${transcode_mode}`, {
            method: 'GET',
        })
    }

    async previewAutoAnnotateAsset(asset_uuid: string, auto_annotate: string, auto_annotate_params?: AutoAnnotateParams): Promise<Annotation> {
        return this.request(`/assets/${asset_uuid}/preview_auto_annotate?auto_annotate=${auto_annotate}`, {
            method: 'POST',
            body: auto_annotate_params ? JSON.stringify(auto_annotate_params) : null,
        })
    }

    // Model methods
    async listModels(): Promise<Model[]> {
        return this.request(`/models?account_uuid=${this._accountId}`, {
            method: 'GET',
        })
    }

    async findModelsForDataset(dataset_uuid: string): Promise<Model[]> {
        return this.request(`/models?dataset_uuid=${dataset_uuid}`, {
            method: 'GET',
        })
    }

    async createModel(dataset_uuid: string, dataset_version: number, data: ModelCreate, start_training: boolean = true): Promise<Model> {
        return this.request(`/models?dataset_uuid=${dataset_uuid}&dataset_version=${dataset_version}&start_training=${start_training}`, {
            method: 'POST',
            body: JSON.stringify(data),
        })
    }

    async getModel(model_uuid: string): Promise<Model> {
        return this.request(`/models/${model_uuid}`, {
            method: 'GET',
        })
    }

    async getModelTrainingProgress(model_uuid: string): Promise<ModelTrainingProgress> {
        return this.request(`/models/${model_uuid}/progress`, {
            method: 'GET',
        })
    }

    async updateModel(model_uuid: string, data: ModelUpdate): Promise<Model> {
        return this.request(`/models/${model_uuid}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        })
    }

    async deleteModel(model_uuid: string): Promise<void> {
        return this.request(`/models/${model_uuid}`, {
            method: 'DELETE',
        })
    }

    async trainModel(model_uuid: string): Promise<Model> {
        return this.request(`/models/${model_uuid}/train`, {
            method: 'POST',
        })
    }

    async publishModel(model_uuid: string): Promise<Model> {
        return this.request(`/models/${model_uuid}/publish`, {
            method: 'POST',
        })
    }

    async exportModel(model_uuid: string, export_by: ExportedBy, params: QcAiHubExportParams[]): Promise<void> {
        if (export_by != ExportedBy.qc_ai_hub) {
            return Promise.reject(`Unexpected export_by ${export_by}, must be 'qc_ai_hub'`)
        }
        await this.request(`/models/${model_uuid}/exports/qc_ai_hub`, {
            method: 'POST',
            body: JSON.stringify(params),
        })
    }

    async downloadModelArtifacts(model_uuid: string, model_formats?: ModelFormat[], device_name?: string, artifact_type?: ArtifactType) {
        const artifactTypeQuery = artifact_type ? `artifact_type=${artifact_type}&` : ''
        const deviceNameQuery = device_name ? `device_name=${encodeURIComponent(device_name)}&` : ''
        let modelFormatQuery = ''
        if (model_formats) {
            for (const model_format of model_formats) {
                modelFormatQuery += `model_format=${model_format}&`
            }
        }
        return this.request(`/exports/model_artifacts/?model_uuid=${model_uuid}&${artifactTypeQuery}${deviceNameQuery}${modelFormatQuery}`, {
            method: 'GET',
        })
    }

    public addAccountEventHandler(eventHandler: OnChangeEvent) {
        this._account_event_handlers.push(eventHandler)
    }

    public removeAccountEventHandler(eventHandler: OnChangeEvent) {
        this._account_event_handlers = this._account_event_handlers.filter(h => h !== eventHandler)
    }

    public addDatasetEventHandler(dataset_uuid: string, eventHandler: OnChangeEvent) {
        let event_handlers = this._dataset_uuid_to_event_handlers.get(dataset_uuid)
        this._logger.debug('addDatasetEventHandler %s', event_handlers)
        if (event_handlers === undefined) {
            event_handlers = []
            this._dataset_uuid_to_event_handlers.set(dataset_uuid, event_handlers)
            const ws = this._ws
            if (ws) {
                const msg = JSON.stringify({ subscribe: { dataset_uuid: dataset_uuid } })
                this._requestLogger.debug('ws send: %s', msg)
                ws.send(msg)
            }
        }
        if (event_handlers.find(h => h === eventHandler) !== eventHandler) {
            this._logger.debug('addDatasetEventHandler event_handlers=%s', event_handlers)
            event_handlers.push(eventHandler)
        }
    }

    public removeDatasetEventHandler(dataset_uuid: string, eventHandler: OnChangeEvent) {
        let event_handlers = this._dataset_uuid_to_event_handlers.get(dataset_uuid)
        if (event_handlers === undefined) {
            return
        }
        event_handlers = event_handlers.filter(h => h !== eventHandler)
        if (event_handlers.length == 0) {
            const ws = this._ws
            if (ws) {
                const msg = JSON.stringify({ unsubscribe: { dataset_uuid: dataset_uuid } })
                this._requestLogger.debug('ws send: %s', msg)
                ws.send(msg)
            }
            this._dataset_uuid_to_event_handlers.delete(dataset_uuid)
        }
    }

    public removeAllDatasetEventHandlers(dataset_uuid: string) {
        let event_handlers = this._dataset_uuid_to_event_handlers.get(dataset_uuid)
        if (event_handlers === undefined) {
            return
        }
        const ws = this._ws
        if (ws) {
            const msg = JSON.stringify({ unsubscribe: { dataset_uuid: dataset_uuid } })
            this._requestLogger.debug('ws send: %s', msg)
            ws.send(msg)
        }
        this._dataset_uuid_to_event_handlers.delete(dataset_uuid)
    }

    public async startWorkflow(account_uuid: string, template_name: string, workflow: CreateWorkflow): Promise<Workflow> {
        return this.request(`/workflows?account_uuid=${account_uuid}&template_name=${template_name}`, {
            method: 'POST',
            body: JSON.stringify(workflow),
        })
    }
    
    public async listWorkflows(account_uuid: string, dataset_uuids?: string[], model_uuids?: string[], phase?: WorkflowPhase[]): Promise<ListWorkFlowItem[]> {
        const datasetQuery = dataset_uuids?.map(uuid => `dataset_uuid=${uuid}`).join('&') || '';
        const modelQuery = model_uuids?.map(uuid => `model_uuid=${uuid}`).join('&') || '';
        const phaseQuery = phase?.map(p => `phase=${p}`).join('&') || '';
        const queryParams = [datasetQuery, modelQuery, phaseQuery].filter(q => q).join('&');
        
        return this.request(`/workflows?account_uuid=${account_uuid}${queryParams ? `&${queryParams}` : ''}`, {
            method: 'GET'
        });
    }

    private async dispatchChangeEvent(change_event: ChangeEvent): Promise<void> {
        switch (change_event.change_type) {
            case ChangeType.dataset_added:
            case ChangeType.dataset_modified:
            case ChangeType.dataset_removed:
            case ChangeType.dataset_version_modified:
                for (let handler of this._account_event_handlers) {
                    await handler(change_event)
                }
            case ChangeType.asset_added:
            case ChangeType.asset_removed:
            case ChangeType.asset_status_modified:
            case ChangeType.asset_annotation_modified:
            case ChangeType.model_added:
            case ChangeType.model_modified:
            case ChangeType.model_removed:
            case ChangeType.model_status_modified:
            case ChangeType.model_progress:
                const event_handlers = this._dataset_uuid_to_event_handlers.get(change_event.dataset_uuid)
                this._logger.debug('dispatchChangeEvent event_handlers=%s', event_handlers)
                if (event_handlers !== undefined) {
                    for (let handler of event_handlers) {
                        await handler(change_event)
                    }
                }
                break
        }
    }
}
