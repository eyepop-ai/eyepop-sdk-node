import { SessionAuth } from '../options'
import { EndpointState } from '../types'
import { createWebSocket } from '../shims/websockets'
import { Endpoint } from '../endpoint'
import urljoin from 'url-join'
import { DataOptions } from './data_options'
import {
    Annotation,
    ArtifactType,
    Asset,
    AssetImport,
    AssetUrlType,
    AutoAnnotateParams,
    ChangeEvent,
    ChangeType,
    CreateWorkflow,
    DataApiType,
    DataSession,
    Dataset,
    DatasetAutoAnnotate,
    DatasetAutoAnnotateCreate,
    DatasetAutoAnnotateUpdate,
    DatasetCreate,
    DatasetHeroAssetUpdate,
    DatasetUpdate,
    DownloadResponse,
    EvaluateRequest,
    ExportedBy,
    getBaseUrl,
    InferRequest,
    ListWorkFlowItem,
    Model,
    ModelCreate,
    ModelFormat,
    ModelTrainingProgress,
    ModelUpdate,
    OnChangeEvent,
    QcAiHubExportParams,
    TranscodeMode,
    UserReview, VlmAbility, VlmAbilityCreate, VlmAbilityGroup, VlmAbilityGroupCreate, VlmAbilityGroupUpdate,
    VlmAbilityUpdate,
    Workflow,
    WorkflowPhase,
} from './data_types'
import { Prediction } from '@eyepop.ai/eyepop'
import { EvaluateDatasetJob, InferAssetJob } from './jobs'

interface DataConfig {
    dataset_api_url: string
    vlm_api_url: string
}

const WS_INITIAL_RECONNECT_DELAY = 1000
const WS_MAX_RECONNECT_DELAY = 60000

export class DataEndpoint extends Endpoint<DataEndpoint> {
    private datasetApiUrl: string | null
    private vlmApiUrl: string | null
    private _accountId: string | null

    private _ws: WebSocket | null
    private _ws_current_reconnect_delay: number | null

    private _account_event_handlers: OnChangeEvent[]
    private _dataset_uuid_to_event_handlers: Map<string, OnChangeEvent[]>

    constructor(options: DataOptions) {
        super(options)
        this.datasetApiUrl = null
        this.vlmApiUrl = null
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
            datasetApiUrl: this.datasetApiUrl as string,
            vlmApiUrl: this.vlmApiUrl as string,
        }
    }

    public override async disconnect(wait: boolean = true): Promise<void> {
        this.datasetApiUrl = null
        this.vlmApiUrl = null
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
        const accountUuidQuery = this._accountId ? `?account_uuid=${this._accountId}` : ''
        const config_url = `${this.eyepopUrl()}/v1/configs${accountUuidQuery}`
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
            return Promise.reject(`Unexpected status ${response.status} for ${config_url}: ${message}`)
        }
        let config = (await response.json()) as DataConfig

        const datasetApiUrl = new URL(config.dataset_api_url, this.eyepopUrl())
        this.datasetApiUrl = datasetApiUrl.toString()
        const vlmApiUrl = new URL(config.vlm_api_url, this.eyepopUrl())
        this.vlmApiUrl = vlmApiUrl.toString()

        if (this.options().disableWs) {
            this._logger.info('disabled ws connection')
        } else {
            await this.reconnect_ws()
        }

        if (this.options().useCookie) {
            const client = this._client
            const url = urljoin(this.datasetApiUrl, 'security', 'check?set_cookie=true')
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
        const baseUrl = this.datasetApiUrl?.replace('https://', 'wss://').replace('http://', 'ws://')
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

    private async request(path: string, options: RequestInit = {}, disableAuth: boolean = false, dataApiType: DataApiType = DataApiType.dataset) {
        const client = this._client
        if (!client) {
            return Promise.reject('endpoint not connected')
        }
        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()

            const baseUrl = getBaseUrl(session, dataApiType)
            const headers = {
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
            this._requestLogger.debug('Request - ' + ri.method + ' ' + path + ' BODY: ' + (ri.body ? ri.body : ''))

            return await client.fetch(urljoin(baseUrl ?? '', path), ri)
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async updateDatasetHeroAsset(dataset_uuid: string, update: DatasetHeroAssetUpdate): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}/hero_asset`, {
            method: 'PATCH',
            body: JSON.stringify(update),
            headers: { 'Content-Type': 'application/json' },
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

    async createDatasetAutoAnnotate(create: DatasetAutoAnnotateCreate, dataset_uuid: string, dataset_version?: number): Promise<void> {
        const versionQuery = dataset_version ? `dataset_version=${dataset_version}&` : ''
        return this.request(`/datasets/${dataset_uuid}/auto_annotates?${versionQuery}`, {
            method: 'POST',
            body: JSON.stringify(create),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async updateDatasetAutoAnnotate(update: DatasetAutoAnnotateUpdate, dataset_uuid: string, auto_annotate: string, source: string, dataset_version?: number): Promise<void> {
        const versionQuery = dataset_version ? `dataset_version=${dataset_version}&` : ''
        return this.request(`/datasets/${dataset_uuid}/auto_annotates?auto_annotate=${auto_annotate}&source=${encodeURIComponent(source)}&${versionQuery}`, {
            method: 'PATCH',
            body: JSON.stringify(update),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async listDatasetAutoAnnotates(dataset_uuid: string, auto_annotate?: string, source?: string, dataset_version?: number): Promise<DatasetAutoAnnotate[]> {
        const versionQuery = dataset_version ? `dataset_version=${dataset_version}&` : ''
        const autoAnnotateQuery = auto_annotate ? `auto_annotate=${auto_annotate}&` : ''
        const sourceQuery = source ? `source=${source}&` : ''
        return this.request(`/datasets/${dataset_uuid}/auto_annotates?${versionQuery}&${autoAnnotateQuery}&${sourceQuery}`, {
            method: 'GET',
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

    async listAssets(
        dataset_uuid: string,
        dataset_version?: number,
        include_annotations: boolean = false,
        top_k?: number
    ): Promise<Asset[]> {
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

    async updateAssetGroundTruth(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, predictions?: Prediction[]): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        return this.request(`/assets/${asset_uuid}/ground_truth?${datasetQuery}${versionQuery}`, {
            method: 'PATCH',
            body: JSON.stringify(predictions),
            headers: { 'Content-Type': 'application/json' },
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

    async addAssetAnnotation(
        asset_uuid: string,
        dataset_uuid?: string,
        dataset_version?: number,
        predictions?: Prediction[],
        auto_annotate?: string,
        source?: string,
        user_review?: UserReview,
        approved_threshold?: number,
    ): Promise<void> {
        const datasetQuery = dataset_uuid ? `dataset_uuid=${dataset_uuid}&` : ''
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}&` : ''
        const autoAnnotateQuery = auto_annotate ? `&auto_annotate=${auto_annotate}&` : ''
        const sourceQuery = source ? `&source=${encodeURIComponent(source)}&` : ''
        const userReviewQuery = user_review ? `&user_review=${user_review}&` : ''
        const approvedThresholdQuery = typeof approved_threshold !== 'undefined' ? `&approved_threshold=${approved_threshold}&` : ''
        return this.request(`/assets/${asset_uuid}/annotations?${datasetQuery}${versionQuery}${autoAnnotateQuery}${sourceQuery}${userReviewQuery}${approvedThresholdQuery}`, {
            method: 'POST',
            body: JSON.stringify(predictions),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async updateAssetAnnotationApproval(
        asset_uuid: string,
        dataset_uuid?: string,
        dataset_version?: number,
        auto_annotate?: string,
        source?: string,
        user_review?: UserReview,
        approved_threshold?: number,
    ): Promise<void> {
        const datasetQuery = dataset_uuid ? `dataset_uuid=${dataset_uuid}&` : ''
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}&` : ''
        const autoAnnotateQuery = auto_annotate ? `&auto_annotate=${auto_annotate}&` : ''
        const sourceQuery = source ? `&source=${encodeURIComponent(source)}&` : ''
        const userReviewQuery = user_review ? `&user_review=${user_review}&` : ''
        const approvedThresholdQuery = approved_threshold ? `&approved_threshold=${approved_threshold}&` : ''
        return this.request(`/assets/${asset_uuid}/annotations?${datasetQuery}${versionQuery}${autoAnnotateQuery}${sourceQuery}${userReviewQuery}${approvedThresholdQuery}`, {
            method: 'PATCH',
        })
    }

    async downloadAsset(
        asset_uuid: string,
        dataset_uuid?: string,
        dataset_version?: number,
        transcode_mode: TranscodeMode = TranscodeMode.original,
        start_timestamp?: number,
        end_timestamp?: number,
        url_type?: AssetUrlType,
    ): Promise<Blob | DownloadResponse> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : ''
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : ''
        const startTimestampQuery = start_timestamp ? `&start_timestamp=${start_timestamp}` : ''
        const endTimestampQuery = end_timestamp ? `&end_timestamp=${end_timestamp}` : ''
        const urlTypeQuery = url_type ? `&url_type=${url_type}` : ''

        return this.request(`/assets/${asset_uuid}/download?transcode_mode=${transcode_mode}${datasetQuery}${versionQuery}${startTimestampQuery}${endTimestampQuery}${urlTypeQuery}`, {
            method: 'GET',
        })
    }

    async previewAutoAnnotateAsset(asset_uuid: string, auto_annotate: string, auto_annotate_params?: AutoAnnotateParams): Promise<Annotation> {
        return this.request(`/assets/${asset_uuid}/preview_auto_annotate?auto_annotate=${auto_annotate}`, {
            method: 'POST',
            body: auto_annotate_params ? JSON.stringify(auto_annotate_params) : null,
            headers: auto_annotate_params? { 'Content-Type': 'application/json' } : {},
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
        })
    }

    public async getWorkflow(workflow_id: string, account_uuid: string): Promise<ListWorkFlowItem> {
        return this.request(`/workflows/${workflow_id}?account_uuid=${account_uuid}`, {
            method: 'GET',
        })
    }

    public async listWorkflows(account_uuid: string, dataset_uuids?: string[], model_uuids?: string[], phases?: WorkflowPhase[]): Promise<ListWorkFlowItem[]> {
        const datasetQuery = dataset_uuids?.map(uuid => `dataset_uuid=${uuid}`).join('&') || ''
        const modelQuery = model_uuids?.map(uuid => `model_uuid=${uuid}`).join('&') || ''
        const phaseQuery = phases?.map(p => `phase=${p}`).join('&') || ''
        const queryParams = [datasetQuery, modelQuery, phaseQuery].filter(q => q).join('&')

        return this.request(`/workflows?account_uuid=${account_uuid}${queryParams ? `&${queryParams}` : ''}`, {
            method: 'GET',
        })
    }

    public async inferAsset(
        asset_uuid: string,
        infer_request: InferRequest,
        dataset_uuid?: string,
        dataset_version?: number,
        transcode_mode?: TranscodeMode,
        start_timestamp?: number,
        end_timestamp?: number,
    ): Promise<InferAssetJob> {
        const datasetQuery = dataset_uuid ? `dataset_uuid=${dataset_uuid}&` : ''
        const versionQuery = dataset_version ? `dataset_version=${dataset_version}&` : ''
        const transcodeModeQuery = transcode_mode ? `transcode_mode=${transcode_mode}&` : ''
        const startTimestampQuery = start_timestamp ? `start_timestamp=${start_timestamp}&` : ''
        const endTimestampQuery = end_timestamp ? `end_timestamp=${end_timestamp}&` : ''

        const assetUrl = `ai.eyepop://data/assets/${asset_uuid}?${transcodeModeQuery}${datasetQuery}${versionQuery}${startTimestampQuery}${endTimestampQuery}`

        if (!this.vlmApiUrl || !this._client || !this._limit) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new InferAssetJob(
                assetUrl,
                infer_request,
                async (path: string, options: any) => {
                    return await this.request(path, options, false, DataApiType.vlm)
                },
                this._requestLogger,
            )
            return job.start(() => {
                this.jobDone(job)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job cannot be started
            this._limit.release()
            throw e
        }
    }

    public async evaluateDataset(
        evaluate_request: EvaluateRequest,
        worker_release?: string
    ): Promise<EvaluateDatasetJob> {
        if (!this.vlmApiUrl || !this._client || !this._limit) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        try {
            this.updateState()
            const job = new EvaluateDatasetJob(
                evaluate_request,
                worker_release ?? null,
                async (path: string, options: any) => {
                    return await this.request(path, options, false, DataApiType.vlm)
                },
                this._requestLogger,
            )
            return job.start(() => {
                this.jobDone(job)
            })
        } catch (e) {
            // we'll have to reset our queue counter in case the job cannot be started
            this._limit.release()
            throw e
        }
    }

    private jobDone(_job: object) {
        this._limit?.release()
    }

    private async dispatchChangeEvent(change_event: ChangeEvent): Promise<void> {
        switch (change_event.change_type) {
            // account event types
            case ChangeType.dataset_added:
            case ChangeType.dataset_modified:
            case ChangeType.dataset_removed:
            case ChangeType.dataset_version_modified:
            case ChangeType.workflow_started:
            case ChangeType.workflow_succeeded:
            case ChangeType.workflow_failed:
            case ChangeType.workflow_task_started:
            case ChangeType.workflow_task_succeeded:
            case ChangeType.workflow_task_failed:
                this._logger.debug('dispatchChangeEvent account_event_handlers=%s', this._account_event_handlers)
                for (let handler of this._account_event_handlers) {
                    await handler(change_event)
                }
                break
            // dataset event types
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

    // Vlm Ability Management

    async listVlmAbilityGroups(): Promise<VlmAbilityGroup[]> {
        return this.request(`/vlm_ability_groups?account_uuid=${this._accountId}`, {
            method: 'GET',
        })
    }

    async createVlmAbilityGroup(create: VlmAbilityGroupCreate): Promise<VlmAbilityGroup> {
        return this.request(`/vlm_ability_groups?account_uuid=${this._accountId}`, {
            method: 'POST',
            body: JSON.stringify(create),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async getVlmAbilityGroup(vlm_ability_group_uuid: string): Promise<VlmAbilityGroup> {
        return this.request(`/vlm_ability_groups/${vlm_ability_group_uuid}`, {
            method: 'GET',
        })
    }

    async deleteVlmAbilityGroup(vlm_ability_group_uuid: string): Promise<void> {
        return this.request(`/vlm_ability_groups/${vlm_ability_group_uuid}`, {
            method: 'DELETE',
        })
    }

    async updateVlmAbilityGroup(vlm_ability_group_uuid: string, update: VlmAbilityGroupUpdate): Promise<VlmAbilityGroup> {
        return this.request(`/vlm_ability_groups/${vlm_ability_group_uuid}`, {
            method: 'PATCH',
            body: JSON.stringify(update),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async listVlmAbilities(): Promise<VlmAbility[]> {
        return this.request(`/vlm_abilities?account_uuid=${this._accountId}`, {
            method: 'GET',
        })
    }

    async createVlmAbility(create: VlmAbilityCreate, vlm_ability_group_uuid?: string): Promise<VlmAbility> {
        const groupQuery = vlm_ability_group_uuid ? `&vlm_ability_group_uuid=${vlm_ability_group_uuid}` : ''
        return this.request(`/vlm_abilities?account_uuid=${this._accountId}${groupQuery}`, {
            method: 'POST',
            body: JSON.stringify(create),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async getVlmAbility(vlm_ability_uuid: string): Promise<VlmAbility> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}`, {
            method: 'GET',
        })
    }

    async deleteVlmAbility(vlm_ability_uuid: string): Promise<void> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}`, {
            method: 'DELETE',
        })
    }

    async updateVlmAbility(vlm_ability_uuid: string, update: VlmAbilityUpdate): Promise<VlmAbility> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}`, {
            method: 'PATCH',
            body: JSON.stringify(update),
            headers: { 'Content-Type': 'application/json' },
        })
    }

    async publishVlmAbility(vlm_ability_uuid: string, alias_name?: string, tag_name?: string): Promise<VlmAbility> {
        const alias_name_query = alias_name ? `alias_name=${encodeURIComponent(alias_name)}&` : ''
        const tag_name_query = tag_name ? `tag_name=${encodeURIComponent(tag_name)}&` : ''
        return this.request(`/vlm_abilities/${vlm_ability_uuid}/publish?${alias_name_query}${tag_name_query}`, {
            method: 'POST',
        })
    }

    async addVlmAbilityAlias(vlm_ability_uuid: string, alias_name: string, tag_name?: string): Promise<VlmAbility> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}/alias/${encodeURIComponent(alias_name)}/tag/${tag_name ? encodeURIComponent(tag_name) : ''}`, {
            method: 'POST',
        })
    }

    async removeVlmAbilityAlias(vlm_ability_uuid: string, alias_name: string, tag_name: string): Promise<VlmAbility> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}/alias/${encodeURIComponent(alias_name)}/tag/${encodeURIComponent(tag_name)}`, {
            method: 'DELETE',
        })
    }

    async listVlmAbilityEvaluations(vlm_ability_uuid: string): Promise<DatasetAutoAnnotate[]> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}/evaluations`, {
            method: 'GET',
        })
    }

    async getVlmAbilityEvaluation(vlm_ability_uuid: string, source: string): Promise<DatasetAutoAnnotate> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}/evaluations/${source}`, {
            method: 'GET',
        })
    }

    async startVlmAbilityEvaluation(vlm_ability_uuid: string, evaluate_request: EvaluateRequest): Promise<DatasetAutoAnnotate> {
        return this.request(`/vlm_abilities/${vlm_ability_uuid}/evaluations`, {
            method: 'POST',
            body: JSON.stringify(evaluate_request),
            headers: { 'Content-Type': 'application/json' },
        })
    }
}
