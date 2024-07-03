import { Auth0Options, OAuth2Auth, Options, SecretKeyAuth, SessionAuth } from "./options"
import { SessionPlus } from './types';
import { HttpClient, createHttpClient } from './shims/http_client';
import { authenticateBrowserSession } from './shims/browser_session';
import { Logger, pino } from "pino"


interface AccessToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface DatasetResponse {
  uuid: string;
  name: string;
  description: string;
  auto_annotates: string[];
  tags: string[];
  account_uuid: string;
  created_at: string;
  updated_at: string;
  versions: any[]; 
}

interface DatasetCreate {
  name: string;
  description: string;
  tags: string[];
  auto_annotates: string[];
}

enum auto_annotates {
  "ep_coco", 
  "ep_rapid_medical"
}

interface DatasetUpdate {
  name: string;
  description: string;
  tags: string[];
  auto_annotates: string[];
}

interface ModelResponse {
  uuid: string;
  name: string;
  description: string;
  type: string;
  status: string;
  account_uuid: string;
  created_at: string;
  updated_at: string;
  dataset_uuid: string;
  dataset_version: number;
}
 
enum AssetStatus {
  rejected = "rejected",
  upload_in_progress = "upload_in_progress",
  upload_failed = "upload_failed",
  transform_failed = "transform_failed",
  transform_in_progress = "transform_in_progress",
  accepted = "accepted"
}

enum ModelStatus {
  requested = "requested",
}

interface ModelCreate {
  name: string;
  description: string;
  type: string;
}

interface ModelUpdate {
  name: string;
  description: string;
  type: string;
}

class Endpoint {
  private _token: string | null
  private _options: Options
  private _expire_token_time: number | null
  private _eyepopDataUrl: string | null = 'https://data.api.eyepop.xyz'
  private _eyepopUrl: string = 'https://staging-api.eyepop.ai'

  private _client: HttpClient | null
  private _clientWsDataset: WebSocket | null
  private _clientWsAccount: WebSocket | null

  private _logger: Logger
  private readonly _requestLogger: Logger

  constructor(options: Options) {
    this._client = null
    this._options = options
    this._token = null
    this._expire_token_time = null

    if (options.passedToken) {
      this._token = options.passedToken;
      const now = Date.now();
      const hours = 24;
      this._expire_token_time = now + hours * 60 * 60 * 1000;
    }

    const sessionAuth: SessionAuth = (options.auth as SessionAuth)
    if (sessionAuth.session !== undefined) {
      const sessionPlus = (sessionAuth.session as SessionPlus)
    }

    if(options.eyepopDataUrl) {
      this._eyepopDataUrl = options.eyepopDataUrl;
    }    

    let rootLogger:any = null
    if (options.logger)
    {
        rootLogger = options.logger
    } else
    {
        rootLogger = pino()
    }
    this._logger = rootLogger.child({ module: 'eyepopdata' })
    this._requestLogger = this._logger.child({ module: 'requests' })
    this._clientWsDataset = null
    this._clientWsAccount = null

  }

  private async request(path: string, options: RequestInit = {}) {    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': await this.authorizationHeader(),
      ...(options.headers || {}),
    };

    if (this._client === null) {
      throw new Error('Client not initialized yet')
    }

    if (!options.body) {
      options.body = null
    }

    const ri = {
      headers: headers,
      method: options.method || 'GET',
      body: options.body //instanceof Blob ? options.body : options.body ? JSON.stringify(options.body) : null
    };

    this._requestLogger.info('Request - '+ri.method +path+(ri.body ? ri.body : ''))

    const response = await this._client.fetch(`${this._eyepopDataUrl}${path}`, ri);

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

    return response.json();
  }

  public async connect(): Promise<Endpoint> {
    if (this._client) {
      this._logger.warn('endpoint already connected')
      return this
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

    if (this._token === null) {
      await this.currentAccessToken()
    }

    return this
  }

  private async  authorizationHeader(): Promise<string> {
    return `Bearer ${await this.currentAccessToken()}`;
  }

  private async currentAccessToken(): Promise<string> {

    this._client = await createHttpClient()
    const client = this._client

    const now = Date.now() / 1000;

    if (!this._token || <number>this._expire_token_time < now) {
      if ((this._options.auth as OAuth2Auth).oAuth2 !== undefined &&
        this._eyepopUrl) {
        const session = await authenticateBrowserSession(((this._options.auth as OAuth2Auth).oAuth2 as Auth0Options),
          this._eyepopUrl)
        this._token = session.accessToken
        this._expire_token_time = session.validUntil / 1000
      } else if ((this._options.auth as SecretKeyAuth).secretKey !== undefined && this._eyepopUrl) {
        const secretKeyAuth = this._options.auth as SecretKeyAuth
        const body = { 'secret_key': secretKeyAuth.secretKey }
        const headers = { 'Content-Type': 'application/json' }
        const post_url = `${this._eyepopUrl}/authentication/token`
        //this._requestLogger.debug('before POST %s', post_url)
        const response = await this._client.fetch(post_url, {
          method: 'POST', headers: headers, body: JSON.stringify(body)
        })
        if (response.status != 200) {
          const message = await response.text()
          return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        
        const data = await response.json()
        const token: AccessToken = data as AccessToken
        this._token = token.access_token
        this._expire_token_time = now + token.expires_in - 60

        
      } else {
        return Promise.reject("no valid auth option")
      }
    }
    return <string>this._token;
  }

  // Health Check
  async healthz() {
    return this.request('/healthz', {
      method: 'GET'
    });
  }

  // Dataset methods
  async listDatasets(account_uuid: string) {
    return this.request(`/datasets?account_uuid=${account_uuid}`, {
      method: 'GET'
    });
  }

  async createDataset(account_uuid: string, data: DatasetCreate) {    
    return this.request(`/datasets?account_uuid=${account_uuid}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDataset(dataset_uuid: string) {
    return this.request(`/datasets/${dataset_uuid}`, {
      method: 'GET'
    });
  }

  async updateDataset(dataset_uuid: string, data: DatasetUpdate) {
    return this.request(`/datasets/${dataset_uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDataset(dataset_uuid: string) {
    return this.request(`/datasets/${dataset_uuid}`, {
      method: 'DELETE'
    });
  }

  async freezeDatasetVersion(dataset_uuid: string, dataset_version?: number) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    return this.request(`/datasets/${dataset_uuid}/freeze?${versionQuery}`, {
      method: 'POST'
    });
  }

  async deleteDatasetVersion(dataset_uuid: string, dataset_version: number) {
    return this.request(`/datasets/${dataset_uuid}/delete?dataset_version=${dataset_version}`, {
      method: 'POST'
    });
  }

  // Asset methods
  async uploadAsset(dataset_uuid: string, dataset_version: number | undefined, file: File) {

    return this.request(`/assets?dataset_uuid=${dataset_uuid}&dataset_version=${dataset_version}`, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type || 'image/*'
      }
    });
  }

  async listAssets(dataset_uuid: string, dataset_version?: number, include_annotations: boolean = false) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const annotationsQuery = include_annotations ? '&include_annotations=true' : '';
    return this.request(`/assets?dataset_uuid=${dataset_uuid}${versionQuery}${annotationsQuery}`, {
      method: 'GET'
    });
  }

  async getAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, include_annotations: boolean = false) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const annotationsQuery = include_annotations ? '&include_annotations=true' : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}${annotationsQuery}`, {
      method: 'GET'
    });
  }

  async deleteAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}`, {
      method: 'DELETE'
    });
  }

  async resurrectAsset(asset_uuid: string, dataset_uuid: string, from_dataset_version: number, into_dataset_version?: number) {
    const intoVersionQuery = into_dataset_version ? `&into_dataset_version=${into_dataset_version}` : '';
    return this.request(`/assets/${asset_uuid}/resurrect?dataset_uuid=${dataset_uuid}&from_dataset_version=${from_dataset_version}${intoVersionQuery}`, {
      method: 'POST'
    });
  }

  async updateAssetManualAnnotation(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, annotation?: any) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}/manual_annotate?${datasetQuery}${versionQuery}`, {
      method: 'PATCH',
      body: JSON.stringify(annotation),
    });
  }

  async downloadAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, transcode_mode: string = 'original') {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}/download?${datasetQuery}${versionQuery}&transcode_mode=${transcode_mode}`, {
      method: 'GET'
    });
  }

  // Model methods
  async listModels(account_uuid: string) {
    return this.request(`/models?account_uuid=${account_uuid}`, {
      method: 'GET'
    });
  }

  async createModel(dataset_uuid: string, dataset_version: number, data: ModelCreate) {
    return this.request(`/models?dataset_uuid=${dataset_uuid}&dataset_version=${dataset_version}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getModel(model_uuid: string) {
    return this.request(`/models/${model_uuid}`, {
      method: 'GET'
    });
  }

  async updateModel(model_uuid: string, data: ModelUpdate) {
    return this.request(`/models/${model_uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteModel(model_uuid: string) {
    return this.request(`/models/${model_uuid}`, {
      method: 'DELETE'
    });
  }

  async publishModel(model_uuid: string) {
    return this.request(`/models/${model_uuid}/publish`, {
      method: 'POST'
    });
  }

  async subscribeCallbackToAccountEvents(account_uuid: string, callback: (event: any) => void, reconnectOnClose: boolean = true) {
    this.subscribeCallbackToWsEvents('account', account_uuid, callback, this._clientWsAccount, reconnectOnClose);
  }

  async subscribeCallbackToDatasetEvents(dataset_uuid: string, callback: (event: any) => void, reconnectOnClose: boolean = true) {
    this.subscribeCallbackToWsEvents('dataset', dataset_uuid, callback, this._clientWsDataset, reconnectOnClose);
  }

  private async subscribeCallbackToWsEvents(type: string, uuid: string, callback: (event: any) => void, ws: WebSocket | null, reconnectOnClose:boolean = true) {

    if (ws !== null) {
      ws.close();
    }

    ws = new WebSocket(this._eyepopDataUrl+'/events');

    const auth_header = await this.authorizationHeader();

    ws.onopen = () => {
      this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [OPEN]")
      this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [AUTHORIZATION HEADER]:", JSON.stringify({ authentication: auth_header }))

      ws.send(JSON.stringify({ authorization: auth_header }));
      if (type == 'account') {
        this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [SUBSCRIBE]:", JSON.stringify({ subscribe: { account_uuid: uuid } }))
        ws.send(JSON.stringify({ subscribe: { account_uuid: uuid } }));
      } else if (type == 'dataset') {
        this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [SUBSCRIBE]:", JSON.stringify({ subscribe: { dataset_uuid: uuid } }))
        ws.send(JSON.stringify({ subscribe: { dataset_uuid: uuid } }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [EVENT]:", event)

      //check that callback is a function
      if (typeof callback !== 'function') {
        return;
      }
      callback(data);      
    };

    ws.onclose = (event: CloseEvent) => {
      const { code, reason } = event;
      this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [CLOSED] [CODE]:", code)
      this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [CLOSED] [REASON]:", reason)
      
      if (reconnectOnClose && reason !== 'unsubscribe') {
        this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [RE-SUBSCRIBE]:", JSON.stringify({ subscribe: { account_uuid: uuid } }))
        this.subscribeCallbackToWsEvents(type, uuid, callback, ws, reconnectOnClose);
      }

      // handle websocket close event
      this._requestLogger.info("DATA EVENT CHANNEL [" + type + "] [CLOSED]")
    };
  }

  async unsubscribeCallbackToAccountEvents() {
    this._requestLogger.info("DATA EVENT CHANNEL [ACCOUNT] [UNSUBSCRIBED]");
    this.unsubscribeCallbackToWsEvents(this._clientWsAccount);
  }

  async unsubscribeCallbackToDatasetEvents() {
    this._requestLogger.info("DATA EVENT CHANNEL [DATASET] [UNSUBSCRIBED]");
    this.unsubscribeCallbackToWsEvents(this._clientWsDataset);
  }

  private async unsubscribeCallbackToWsEvents(ws: WebSocket | null) {
    
    if (ws == null) {
      return;
    }

    ws.onclose = null;
    ws.onmessage = null;
    ws.onopen = null;

    this._requestLogger.info("DATA EVENT CHANNEL [WEB SOCKET CLOSED]");
    ws.close(1000, 'unsubscribe');
    ws = null;
  }
}

export { Endpoint, DatasetCreate, DatasetUpdate, ModelCreate, ModelUpdate, DatasetResponse, ModelResponse, AssetStatus, ModelStatus};