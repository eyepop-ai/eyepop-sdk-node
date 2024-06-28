import fetch, { RequestInit } from 'node-fetch';
import { Auth0Options, OAuth2Auth, Options, SecretKeyAuth, SessionAuth } from "./options"
import { SessionPlus } from './types';
import { HttpClient, createHttpClient } from './shims/http_client';
import { authenticateBrowserSession } from './shims/browser_session';

//TODO 
// Implement websocket for events
// 

interface AccessToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface DatasetResponse {
  uuid: string;
  name: string;
  description: string;
  tags: string[];
  account_uuid: string;
  created_at: string;
  updated_at: string;
  versions: any[]; // Define specific type if available
}

interface DatasetCreate {
  name: string;
  description: string;
  tags: string[];
}

interface DatasetUpdate {
  name: string;
  description: string;
  tags: string[];
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

class Endpoint { //TODO
  private _token: string | null
  private _options: Options
  private _expire_token_time: number | null
  private _baseUrl: string | null = 'https://data.api.eyepop.xyz'
  private _eyepopUrl: string = 'https://staging-api.eyepop.ai'

  private _client: HttpClient | null
  //private _limit: Semaphore

  // private _state: EndpointState
  // private _stateChangeHandler: null | ((fromState: EndpointState, toState: EndpointState) => void)
  // private _ingressEventHandler: null | ((event: IngressEvent) => void)
  // private _ingressEventWs: WebSocket | null

  //private _logger: Logger
  //private readonly _requestLogger: Logger



  //TODO: Convert token to session token
  //TODO: Refetch token if expired
  //TODO: Endpoint
  //TODO: .connect etc....
  //TODO: SIMILAR PATTERN for config for endpoint for account (Give me my dataset endpoint)
  //data.eyepop.api.eyepo.xyz
  //andy@eyepop.ai (auth0 permission)
  //foo organization


  //websocket https://data.api.eyepop.xyz/events
  //First authenticate same as header auth
  //{"authentication": "Bearer ...."}
  // Response: status 201 
  //{"subscribe":{"account_uuid":"..."}}   //ONLY DATASET CHANGES
  //{"subscribe":{"dataset_uuid":"..."}}   //Asset and model changes
  //End of connection alert - because even an empty line will break it


  constructor(options: Options) {
    this._client = null
    this._options = options
    //this._options.eyepopUrl = 'https://staging-api.eyepop.xyz'
    //this._baseUrl = null

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

    //this._limit = new Semaphore(this._options.jobQueueLength ?? 1024)

    // let rootLogger
    // if (options.logger) {
    //   rootLogger = options.logger
    // } else {
    //   rootLogger = pino()
    // }
    // this._logger = rootLogger.child({ module: 'eyepop' })
    // this._requestLogger = this._logger.child({ module: 'requests' })
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

    console.log('url', `${this._baseUrl}${path}`)

    const ri = {
      headers: headers,
      method: options.method || 'GET',
      body: options.body instanceof Blob ? options.body : options.body ? JSON.stringify(options.body) : null
    };

    const response = await this._client.fetch(`${this._baseUrl}${path}`, ri);

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
      //this._logger.warn('endpoint already connected')
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

  //   private async reconnect(): Promise<Endpoint> {
  //     if (!this._client) {
  //         return Promise.reject("endpoint not initialized")
  //     }

  //     const headers = {
  //         'Authorization': await this.authorizationHeader()
  //     }
  //     this.updateState(EndpointState.FetchConfig)
  //     this._requestLogger.debug('before GET %s', config_url)
  //     let response = await this._client.fetch(config_url, {headers: headers})
  //     if (response.status == 401) {
  //         this._requestLogger.debug('after GET %s: 401, about to retry with fresh access token', config_url)
  //         // one retry, the token might have just expired
  //         this._token = null
  //         const headers = {
  //             'Authorization': await this.authorizationHeader()
  //         }
  //         this.updateState(EndpointState.FetchConfig)
  //         response = await this._client.fetch(config_url, {
  //             headers: headers
  //         })
  //     }

  //     if (response.status != 200) {
  //         this.updateState(EndpointState.Error)
  //         const message = await response.text()
  //         return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //     } else {
  //         let config = (await response.json()) as PopConfig
  //         if (!config.base_url && this._options.autoStart) {
  //             const auto_start_config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=true`
  //             this._requestLogger.debug('pop was not running, trying to autostart with: %s', auto_start_config_url)
  //             // one retry the pop might just have stopped
  //             const headers = {
  //                 'Authorization': await this.authorizationHeader()
  //             }
  //             this.updateState(EndpointState.StartingPop)
  //             response = await this._client.fetch(auto_start_config_url, {
  //                 headers: headers
  //             })
  //             if (response.status != 200) {
  //                 this.updateState(EndpointState.Error)
  //                 const message = await response.text()
  //                 return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //             }
  //             config = (await response.json()) as PopConfig
  //         }

  //         const baseUrl = new URL(config.base_url, this.eyepopUrl())
  //         this._baseUrl = baseUrl.toString()
  //         if (this._options.popId == TransientPopId.Transient) {
  //             this._pipelineId = await this.startPopLessPipeline()
  //             this._popName = this._options.popId
  //         } else {
  //             this._pipelineId = config.pipeline_id
  //             this._popName = config.name
  //         }
  //         this._requestLogger.debug('after GET %s: %s / %s', config_url, this._baseUrl, this._pipelineId)
  //         if (!this._pipelineId || !this._baseUrl) {
  //             return Promise.reject(`Pop not started`)
  //         }
  //         this._baseUrl = this._baseUrl.replace(/\/+$/, "")

  //         if (this._baseUrl) {
  //             const get_url = `${this._baseUrl}/pipelines/${this._pipelineId}`
  //             const headers = {
  //                 'Authorization': await this.authorizationHeader()
  //             }
  //             this._requestLogger.debug('before GET %s', get_url)
  //             let response = await this._client.fetch(get_url, {
  //                 method: 'GET',
  //                 headers: headers
  //             })
  //             if (response.status > 200) {
  //                 const message = await response.text()
  //                 return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //             }
  //             this._requestLogger.debug('after GET %s', get_url)
  //             this._pipeline = (await response.json()) as Pipeline
  //         }

  //         this.updateState()
  //         return Promise.resolve(this)
  //     }
  // }
  private async authorizationHeader(): Promise<string> {
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
        //this._requestLogger.debug('after POST %s', post_url)
        const data = await response.json()
        const token: AccessToken = data as AccessToken
        this._token = token.access_token
        this._expire_token_time = now + token.expires_in - 60

        console.log('token', this._token)
      } else {
        return Promise.reject("no valid auth option")
      }
    }
    return <string>this._token;
  }
  //   const now = Date.now() / 1000;
  //   if (!this._token || <number>this._expire_token_time < now) {
  //       //this.updateState(EndpointState.Authenticating)
  //       try {
  //           if (!this._client) {
  //               return Promise.reject("endpoint not connected")
  //           } else if ((this._options.auth as SessionAuth).session !== undefined) {
  //               return Promise.reject("temporary access token expired")
  //           } else if ((this._options.auth as OAuth2Auth).oAuth2 !== undefined &&
  //               this._options.eyepopUrl && this._options.popId) {
  //               const session = await authenticateBrowserSession(((this._options.auth as OAuth2Auth).oAuth2 as Auth0Options),
  //                   this._options.eyepopUrl, this._options.popId)
  //               this._token = session.accessToken
  //               this._expire_token_time = session.validUntil / 1000
  //           } else if ((this._options.auth as SecretKeyAuth).secretKey !== undefined && this._options.eyepopUrl) {
  //               const secretKeyAuth = this._options.auth as SecretKeyAuth
  //               const body = {'secret_key': secretKeyAuth.secretKey}
  //               const headers = {'Content-Type': 'application/json'}
  //               const post_url = `${this.eyepopUrl()}/authentication/token`
  //               this._requestLogger.debug('before POST %s', post_url)
  //               const response = await this._client.fetch(post_url, {
  //                   method: 'POST', headers: headers, body: JSON.stringify(body)
  //               })
  //               if (response.status != 200) {
  //                   const message = await response.text()
  //                   return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //               }
  //               this._requestLogger.debug('after POST %s', post_url)
  //               const data = await response.json()
  //               const token: AccessToken = data as AccessToken
  //               this._token = token.access_token
  //               this._expire_token_time = now + token.expires_in - 60
  //           } else {
  //               return Promise.reject("no valid auth option")
  //           }
  //       } finally {
  //           this.updateState()
  //       }
  //   }
  //   this._logger.debug('using access token, valid for at least %d seconds', <number>this._expire_token_time - now)
  //   return <string>this._token
  // }


  // private async fetchWithRetry(fetcher: () => Promise<Response>, retries: number = 1): Promise<Response> {
  //   while (true) {
  //     try {
  //       const response = await fetcher()
  //       if (response.status == 401) {
  //         this._token = null;
  //         this._expire_token_time = null;
  //         if (retries--) {
  //           this._requestLogger.info('received 401 response, attempt to reauthorize and retry')
  //         } else {
  //           return Promise.reject(`response ${response.status}: ${response.statusText}`)
  //         }
  //       } else if (response.status == 404) {
  //         this._pipelineId = null;
  //         this._baseUrl = null;
  //         if (retries--) {
  //           this._requestLogger.info('received 404 response, attempt to restart pop and retry')
  //         } else {
  //           return Promise.reject(`response ${response.status}: ${response.statusText}`)
  //         }
  //       } else {
  //         return response
  //       }
  //     } catch (error) {
  //       this._pipelineId = null;
  //       this._baseUrl = null;
  //       if (retries--) {
  //         this._requestLogger.info('unknown, attempt to restart pop (as if we received 404)', error)
  //         return Promise.reject(error)
  //       }
  //     }
  //   }
  // }

  // private async reconnect(): Promise<Endpoint> {
  //   if (!this._client) {
  //     return Promise.reject("endpoint not initialized")
  //   }
  //   let config_url
  //   if (this._options.popId == TransientPopId.Transient) {
  //     config_url = `${this.eyepopUrl()}/workers/config`
  //   } else {
  //     config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=false`
  //   }
  //   const headers = {
  //     'Authorization': await this.authorizationHeader()
  //   }
  //   this.updateState(EndpointState.FetchConfig)
  //   this._requestLogger.debug('before GET %s', config_url)
  //   let response = await this._client.fetch(config_url, { headers: headers })
  //   if (response.status == 401) {
  //     this._requestLogger.debug('after GET %s: 401, about to retry with fresh access token', config_url)
  //     // one retry, the token might have just expired
  //     this._token = null
  //     const headers = {
  //       'Authorization': await this.authorizationHeader()
  //     }
  //     this.updateState(EndpointState.FetchConfig)
  //     response = await this._client.fetch(config_url, {
  //       headers: headers
  //     })
  //   }

  //   if (response.status != 200) {
  //     this.updateState(EndpointState.Error)
  //     const message = await response.text()
  //     return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //   } else {
  //     let config = (await response.json()) as PopConfig
  //     if (!config.base_url && this._options.autoStart) {
  //       const auto_start_config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=true`
  //       this._requestLogger.debug('pop was not running, trying to autostart with: %s', auto_start_config_url)
  //       // one retry the pop might just have stopped
  //       const headers = {
  //         'Authorization': await this.authorizationHeader()
  //       }
  //       this.updateState(EndpointState.StartingPop)
  //       response = await this._client.fetch(auto_start_config_url, {
  //         headers: headers
  //       })
  //       if (response.status != 200) {
  //         this.updateState(EndpointState.Error)
  //         const message = await response.text()
  //         return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //       }
  //       config = (await response.json()) as PopConfig
  //     }

  //     const baseUrl = new URL(config.base_url, this.eyepopUrl())
  //     this._baseUrl = baseUrl.toString()
  //     if (this._options.popId == TransientPopId.Transient) {
  //       this._pipelineId = await this.startPopLessPipeline()
  //       this._popName = this._options.popId
  //     } else {
  //       this._pipelineId = config.pipeline_id
  //       this._popName = config.name
  //     }
  //     this._requestLogger.debug('after GET %s: %s / %s', config_url, this._baseUrl, this._pipelineId)
  //     if (!this._pipelineId || !this._baseUrl) {
  //       return Promise.reject(`Pop not started`)
  //     }
  //     this._baseUrl = this._baseUrl.replace(/\/+$/, "")

  //     if (this._baseUrl) {
  //       const get_url = `${this._baseUrl}/pipelines/${this._pipelineId}`
  //       const headers = {
  //         'Authorization': await this.authorizationHeader()
  //       }
  //       this._requestLogger.debug('before GET %s', get_url)
  //       let response = await this._client.fetch(get_url, {
  //         method: 'GET',
  //         headers: headers
  //       })
  //       if (response.status > 200) {
  //         const message = await response.text()
  //         return Promise.reject(`Unexpected status ${response.status}: ${message}`)
  //       }
  //       this._requestLogger.debug('after GET %s', get_url)
  //       this._pipeline = (await response.json()) as Pipeline
  //     }

  //     this.updateState()
  //     return Promise.resolve(this)
  //   }
  // }
  // public async session(): Promise<SessionPlus> {
  //   await this.currentAccessToken()
  //   if (this._token == null || this._expire_token_time == null) {
  //     return Promise.reject("endpoint not connected")
  //   }
  //   if (this._baseUrl == null || this._pipelineId == null) {
  //     await this.reconnect()
  //     if (this._baseUrl == null || this._pipelineId == null) {
  //       return Promise.reject("endpoint not connected")
  //     }
  //   }
  //   return {
  //     eyepopUrl: <string>this._options.eyepopUrl,
  //     popId: <string>this._options.popId,
  //     accessToken: this._token,
  //     validUntil: this._expire_token_time * 1000,
  //     baseUrl: this._baseUrl,
  //     pipelineId: this._pipelineId,
  //     sandboxId: this._sandboxId ?? undefined
  //   }
  // }

  // Health Check
  async healthz() {
    return this.request('/healthz', { method: 'GET' });
  }

  // Dataset methods
  async listDatasets(account_uuid: string) {
    return this.request(`/datasets?account_uuid=${account_uuid}`, { method: 'GET' });
  }

  async createDataset(account_uuid: string, data: DatasetCreate) {
    return this.request(`/datasets?account_uuid=${account_uuid}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDataset(dataset_uuid: string) {
    return this.request(`/datasets/${dataset_uuid}`, { method: 'GET' });
  }

  async updateDataset(dataset_uuid: string, data: DatasetUpdate) {
    return this.request(`/datasets/${dataset_uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDataset(dataset_uuid: string) {
    return this.request(`/datasets/${dataset_uuid}`, { method: 'DELETE' });
  }

  async freezeDatasetVersion(dataset_uuid: string, dataset_version?: number) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    return this.request(`/datasets/${dataset_uuid}/freeze?${versionQuery}`, { method: 'POST' });
  }

  async deleteDatasetVersion(dataset_uuid: string, dataset_version: number) {
    return this.request(`/datasets/${dataset_uuid}/delete?dataset_version=${dataset_version}`, { method: 'POST' });
  }

  // Asset methods
  async uploadAsset(dataset_uuid: string, dataset_version: number | undefined, file: File) {
    
    
    console.log('file in node', file.type, file.size, file.name)
    //console.log("formdata", formData.get(''))

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
    return this.request(`/assets?dataset_uuid=${dataset_uuid}${versionQuery}${annotationsQuery}`, { method: 'GET' });
  }

  async getAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, include_annotations: boolean = false) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const annotationsQuery = include_annotations ? '&include_annotations=true' : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}${annotationsQuery}`, { method: 'GET' });
  }

  async deleteAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}?${datasetQuery}${versionQuery}`, { method: 'DELETE' });
  }

  async resurrectAsset(asset_uuid: string, dataset_uuid: string, from_dataset_version: number, into_dataset_version?: number) {
    const intoVersionQuery = into_dataset_version ? `&into_dataset_version=${into_dataset_version}` : '';
    return this.request(`/assets/${asset_uuid}/resurrect?dataset_uuid=${dataset_uuid}&from_dataset_version=${from_dataset_version}${intoVersionQuery}`, { method: 'POST' });
  }

  async updateAssetManualAnnotation(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, annotation?: any) {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}/manual_annotation?${datasetQuery}${versionQuery}`, {
      method: 'PATCH',
      body: JSON.stringify(annotation),
    });
  }

  async downloadAsset(asset_uuid: string, dataset_uuid?: string, dataset_version?: number, transcode_mode: string = 'original') {
    const versionQuery = dataset_version ? `&dataset_version=${dataset_version}` : '';
    const datasetQuery = dataset_uuid ? `&dataset_uuid=${dataset_uuid}` : '';
    return this.request(`/assets/${asset_uuid}/download?${datasetQuery}${versionQuery}&transcode_mode=${transcode_mode}`, { method: 'GET' });
  }

  // Model methods
  async listModels(account_uuid: string) {
    return this.request(`/models?account_uuid=${account_uuid}`, { method: 'GET' });
  }

  async createModel(dataset_uuid: string, dataset_version: number, data: ModelCreate) {
    return this.request(`/models?dataset_uuid=${dataset_uuid}&dataset_version=${dataset_version}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getModel(model_uuid: string) {
    return this.request(`/models/${model_uuid}`, { method: 'GET' });
  }

  async updateModel(model_uuid: string, data: ModelUpdate) {
    return this.request(`/models/${model_uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteModel(model_uuid: string) {
    return this.request(`/models/${model_uuid}`, { method: 'DELETE' });
  }

  async publishModel(model_uuid: string) {
    return this.request(`/models/${model_uuid}/publish`, { method: 'POST' });
  }
}

export { Endpoint, DatasetCreate, DatasetUpdate, ModelCreate, ModelUpdate, DatasetResponse, ModelResponse };
