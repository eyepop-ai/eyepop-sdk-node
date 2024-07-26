import {SessionAuth} from "../options"
import {EndpointState} from "../types"
import {createWebSocket} from "../shims/websockets"
import {Endpoint} from "../endpoint"
import urljoin from "url-join"
import {DataOptions} from "./data_options"
import {
    Annotation,
    Asset,
    ChangeEvent,
    ChangeType,
    DataSession,
    Dataset,
    DatasetCreate,
    DatasetUpdate,
    Model,
    ModelCreate,
    ModelUpdate,
    OnChangeEvent,
    TranscodeMode,
    UserReview
} from "./data_types";
import {Prediction} from "@eyepop.ai/eyepop";


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
        const sessionAuth: SessionAuth = (options.auth as SessionAuth)
        if (sessionAuth.session !== undefined) {
            const dataSession = (sessionAuth.session as DataSession)
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
                this._logger.warn("ignored exception", e)
            }
            this._ws = null
        }
        await super.disconnect(wait)
    }

    protected override async reconnect(): Promise<DataEndpoint> {
        if (!this._client) {
            return Promise.reject("endpoint not initialized")
        }
        const config_url = `${this.eyepopUrl()}/data/config?account_uuid=${this._accountId}`
        let headers = {
            'Authorization': await this.authorizationHeader()
        }
        this.updateState(EndpointState.FetchConfig)
        this._requestLogger.debug('before GET %s', config_url)
        let response = await this._client.fetch(config_url, {headers: headers})
        if (response.status == 401) {
            this._requestLogger.debug('after GET %s: 401, about to retry with fresh access token', config_url)
            // one retry, the token might have just expired
            this.statusHandler401(response.status)
            headers = {
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
        }
        let config = (await response.json()) as DataConfig
        this._requestLogger.debug('after GET %s', config_url)
        const baseUrl = new URL(config.base_url, this.eyepopUrl())
        this._baseUrl = baseUrl.toString()

        if (this.options().disableWs) {
            this._logger.info("disabled ws connection")
        } else {
            await this.reconnect_ws()
        }

        this.updateState()
        return Promise.resolve(this)
    }

    private async reconnect_ws(): Promise<void> {
        if (this._ws) {
            this._ws.close()
            this._ws = null
        }
        const baseUrl = this._baseUrl?.replace("https://", "wss://").replace("http://", "ws://")
        if (!baseUrl) {
            return
        }
        const ws_url = urljoin(baseUrl, 'events')
        this._requestLogger.debug("about to connect ws to: %s", ws_url)
        return new Promise((resolve, reject) => {
            const ws = createWebSocket(ws_url);
            if (!ws) {
                return resolve()
            }
            this._ws = ws

            ws.onopen = async () => {
                const auth_header = await this.authorizationHeader();
                let msg = JSON.stringify({authorization: auth_header})
                this._requestLogger.debug("ws send: %s", msg)
                ws.send(msg)
                msg = JSON.stringify({subscribe: {account_uuid: this._accountId}})
                this._requestLogger.debug("ws send: %s", msg)
                ws.send(msg)
                for (let dataset_uuid in this._dataset_uuid_to_event_handlers.keys()) {
                    const msg = JSON.stringify({subscribe: {dataset_uuid: dataset_uuid}})
                    this._requestLogger.debug("ws send: %s", msg)
                    ws.send(msg)
                }
                this._ws_current_reconnect_delay = WS_INITIAL_RECONNECT_DELAY
                resolve()
            }

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this._requestLogger.debug("received ws: %s", JSON.stringify(data))
                const change_event = data as ChangeEvent
                this.dispatchChangeEvent(change_event)
            };

            ws.onclose = (event: CloseEvent) => {
                const {code, reason} = event;
                this._requestLogger.debug("ws closed: %d %s", code, reason)

                if (reason !== 'unsubscribe') {
                    if (!this._ws_current_reconnect_delay) {
                        this._ws_current_reconnect_delay = WS_INITIAL_RECONNECT_DELAY
                    } else if (this._ws_current_reconnect_delay < WS_MAX_RECONNECT_DELAY) {
                        this._ws_current_reconnect_delay *= 1.5
                    }
                    setTimeout(async () => {
                        await this.reconnect_ws();
                    }, this._ws_current_reconnect_delay);
                }
            };

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
            return Promise.reject("endpoint not connected, use connect() before changePopComp()")
        }

        let response = await this.fetchWithRetry(async () => {
            const session = await this.session()
            const headers = {
                'Content-Type': 'application/json', ...(disableAuth ? {} : {'Authorization': `Bearer ${session.accessToken}`}), ...(options.headers || {}),
            };

            if (!options.body) {
                options.body = null
            }

            const ri = {
                headers: headers, method: options.method || 'GET', body: options.body
            };

            this._requestLogger.debug('Request - ' + ri.method + path + " BODY: " + (ri.body ? ri.body : ''))

            return await client.fetch(urljoin(session.baseUrl ?? "", path), ri);
        })

        if (response.status === 204) {
            return null; // Return null if the response is completely empty
        }

        if (!response.ok) {
            const errorData = await response.json() as any;
            throw new Error(errorData.detail || 'Request failed');
        }

        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.startsWith('image/')) {
            const blob = await response.blob();
            return blob;
        }

        //log whole response
        this._requestLogger.debug('Response - ' + response.status + " " + response.statusText)


        return response.json();
    }

    async listDatasets(include_hero_asset: boolean = false): Promise<Dataset[]> {
        return this.request(`/datasets?account_uuid=${this._accountId}&include_hero_asset=${include_hero_asset}`, {
            method: 'GET'
        });
    }

    async createDataset(data: DatasetCreate): Promise<Dataset> {
        return this.request(`/datasets?account_uuid=${this._accountId}`, {
            method: 'POST', body: JSON.stringify(data),
        });
    }

    async getDataset(dataset_uuid: string, include_hero_asset: boolean = false): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}?include_hero_asset=${include_hero_asset}`, {
            method: 'GET'
        });
    }

    async updateDataset(dataset_uuid: string, data: DatasetUpdate): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}`, {
            method: 'PATCH', body: JSON.stringify(data),
        });
    }

    async deleteDataset(dataset_uuid: string): Promise<void> {
        return this.request(`/datasets/${dataset_uuid}`, {
            method: 'DELETE'
        });
    }

    async freezeDatasetVersion(dataset_uuid: string, dataset_version?: number): Promise<Dataset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
        return this.request(`/datasets/${dataset_uuid}/freeze?${versionQuery}`, {
            method: 'POST'
        });
    }

    async deleteDatasetVersion(dataset_uuid: string, dataset_version: number): Promise<Dataset> {
        return this.request(`/datasets/${dataset_uuid}/delete?dataset_version=${dataset_version}`, {
            method: 'POST'
        });
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
            method: 'POST', body: blob, headers: {
                'Content-Type': blob.type || 'application/octet-stream'
            }
        });
    }

    async listAssets(dataset_uuid: string, dataset_version?: number, include_annotations: boolean = false): Promise<Asset[]> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
        const annotationsQuery = include_annotations ? '&include_annotations=true' : '';
        return this.request(`/assets?dataset_uuid=${dataset_uuid}${versionQuery}${annotationsQuery}`, {
            method: 'GET'
        });
    }

    async getAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, include_annotations: boolean = false): Promise<Asset> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
        const annotationsQuery = include_annotations ? '&include_annotations=true' : '';
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
        return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}${annotationsQuery}`, {
            method: 'GET'
        });
    }

    async deleteAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
        return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}`, {
            method: 'DELETE'
        });
    }

    async resurrectAsset(asset_uuid: string, dataset_uuid: string, from_dataset_version: number, into_dataset_version?: number): Promise<void> {
        const intoVersionQuery = into_dataset_version ? `&into_dataset_version=${into_dataset_version}` : '';
        return this.request(`/assets/${asset_uuid}/resurrect?dataset_uuid=${dataset_uuid}&from_dataset_version=${from_dataset_version}${intoVersionQuery}`, {
            method: 'POST'
        });
    }

    async updateAssetManualAnnotation(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, prediction?: Prediction): Promise<void> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
        return this.request(`/assets/${asset_uuid}/manual_annotate?${datasetQuery}${versionQuery}`, {
            method: 'PATCH', body: JSON.stringify(prediction),
        });
    }

    async updateAutoAnnotationStatus(asset_uuid: string, auto_annotate: string, user_review: UserReview): Promise<void> {
        const validStatuses = ['approved', 'rejected', 'unknown'];
        if (!validStatuses.includes(user_review)) {
            throw new Error('Invalid status');
        }
        return this.request(`/assets/${asset_uuid}/auto_annotations/${auto_annotate}/user_review/${user_review}`, {
            method: 'PATCH'
        });
    }

    async downloadAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, transcode_mode: TranscodeMode = TranscodeMode.original): Promise<Blob> {
        const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
        const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
        return this.request(`/assets/${asset_uuid}/download?${datasetQuery}${versionQuery}&transcode_mode=${transcode_mode}`, {
            method: 'GET'
        });
    }

    // Model methods
    async listModels(): Promise<Model[]> {
        return this.request(`/models?account_uuid=${this._accountId}`, {
            method: 'GET'
        });
    }

    async createModel(dataset_uuid: string, dataset_version: number, data: ModelCreate): Promise<Model> {
        return this.request(`/models?dataset_uuid=${dataset_uuid}&dataset_version=${dataset_version}`, {
            method: 'POST', body: JSON.stringify(data),
        });
    }

    async getModel(model_uuid: string): Promise<Model> {
        return this.request(`/models/${model_uuid}`, {
            method: 'GET'
        });
    }

    async updateModel(model_uuid: string, data: ModelUpdate): Promise<Model> {
        return this.request(`/models/${model_uuid}`, {
            method: 'PATCH', body: JSON.stringify(data),
        });
    }

    async deleteModel(model_uuid: string): Promise<void> {
        return this.request(`/models/${model_uuid}`, {
            method: 'DELETE'
        });
    }

    async publishModel(model_uuid: string): Promise<Model> {
        return this.request(`/models/${model_uuid}/publish`, {
            method: 'POST'
        });
    }

    public addAccountEventHandler(eventHandler: OnChangeEvent) {
        this._account_event_handlers.push(eventHandler)
    }

    public removeAccountEventHandler(eventHandler: OnChangeEvent) {
        this._account_event_handlers = this._account_event_handlers.filter(h => h !== eventHandler)
    }

    public addDatasetEventHandler(dataset_uuid: string, eventHandler: OnChangeEvent) {
        let event_handlers = this._dataset_uuid_to_event_handlers.get(dataset_uuid)
        this._logger.debug("addDatasetEventHandler %s", event_handlers)
        if (event_handlers === undefined) {
            event_handlers = []
            this._dataset_uuid_to_event_handlers.set(dataset_uuid, event_handlers)
            const ws = this._ws
            if (ws) {
                const msg = JSON.stringify({subscribe: {dataset_uuid: dataset_uuid}})
                this._requestLogger.debug("ws send: %s", msg)
                ws.send(msg)
            }
        }
        if (event_handlers.find(h => h === eventHandler) !== eventHandler) {
            this._logger.debug("addDatasetEventHandler event_handlers=%s", event_handlers)
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
                const msg = JSON.stringify({unsubscribe: {dataset_uuid: dataset_uuid}})
                this._requestLogger.debug("ws send: %s", msg)
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
            const msg = JSON.stringify({unsubscribe: {dataset_uuid: dataset_uuid}})
            this._requestLogger.debug("ws send: %s", msg)
            ws.send(msg)
        }
        this._dataset_uuid_to_event_handlers.delete(dataset_uuid)
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
                const event_handlers = this._dataset_uuid_to_event_handlers.get(change_event.dataset_uuid)
                this._logger.debug("dispatchChangeEvent event_handlers=%s", event_handlers)
                if (event_handlers !== undefined) {
                    for (let handler of event_handlers) {
                        await handler(change_event)
                    }
                }
                break
        }
    }
}