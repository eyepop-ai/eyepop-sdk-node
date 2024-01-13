import {Options} from "./options"
import {Job, LoadFromJob, UploadJob} from "./jobs"
import {Prediction} from "./types"
import * as fs from "fs"
import stream from "node:stream"
import mime from "mime-types"
import {Agent, Dispatcher, Pool} from "undici";

interface PopConfig {
    base_url: string;
    pipeline_id: string;
}

interface AccessToken {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export interface UploadParams {
  readonly filePath?: string | undefined;
  readonly stream?: stream.Readable | undefined;
  readonly mimeType?: string | undefined;
}

export class Endpoint {

    private _options: Options
    private _token: string | null
    private _expire_token_time: number | null
    private _baseUrl: string | null
    private _pipelineId: string | null

    private _dispatcher: Dispatcher | null

    constructor(options: Options) {
        this._options = options
        this._baseUrl = null
        this._pipelineId = null
        this._token = null
        this._expire_token_time = null
        this._dispatcher = null
    }

    public async upload(params: UploadParams): Promise<Job> {
        if (!this._baseUrl || !this._pipelineId || !this._dispatcher) {
            return Promise.reject("endpoint not connected, use open() before upload()")
        }
        let mimeType = null
        let stream = null
        if (params.filePath) {
            if (params.mimeType) {
                mimeType = params.mimeType
            } else {
                mimeType = mime.lookup(params.filePath)
            }
            stream = fs.createReadStream(params.filePath)
        } else if (params.stream) {
            stream = params.stream
            mimeType = params.mimeType
        }
        if (!mimeType) {
            return Promise.reject("upload for streams requires a mimeType")
        }
        const job = new UploadJob(stream, mimeType, this._baseUrl, this._pipelineId, await this.authorizationHeader(), this._dispatcher)
        return job.start()
    }

    public async loadFrom(location: string): Promise<Job> {
        if (!this._baseUrl || !this._pipelineId || !this._dispatcher) {
            throw new Error("endpoint not connected, use open() before loadFrom()")
        }
        const job = new LoadFromJob(location, this._baseUrl, this._pipelineId, await this.authorizationHeader(), this._dispatcher)
        return job.start()
    }

    public async connect():Promise<void> {
        if (!this._options.eyepopUrl) {
            return Promise.reject("option eyepopUrl or environment variable EYEPOP_URL is required")
        }
        if (!this._options.popId) {
            return Promise.reject("option popId or environment variable EYEPOP_POP_ID is required")
        }
        if (!this._options.secretKey) {
            return Promise.reject("option secretKey or environment variable EYEPOP_SECRET_KEY is required")
        }

       this._dispatcher = new Agent({
           keepAliveTimeout: 10000,
           pipelining: 100,
           maxConcurrentStreams: 100,
           maxCachedSessions: 100,
           connections: 5
        })

        const config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=${this._options.autoStart}`
        const headers = {
            'Authorization': await this.authorizationHeader()
        }
        let response = await fetch(config_url, {headers: headers})
        if (response.status == 401) {
            // one retry, the token might have just expired
            this._token = null
            const config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=${this._options.autoStart}`
            const headers = {
                'Authorization': await this.authorizationHeader()
            }
            response = await fetch(config_url, {
                headers: headers,
                // @ts-ignore
                dispatcher: this._dispatcher
            })
        }
        if (response.status != 200) {
            const message = await response.text()
            return Promise.reject(`Unexpected status ${response.status}: ${message}`)
        }
        const data = await response.json()
        const config: PopConfig = data as PopConfig
        this._baseUrl = config.base_url;
        this._pipelineId = config.pipeline_id;
    }

    public async disconnect() {
        if (this._dispatcher) {
            await this._dispatcher.close()
        }
    }

    protected async authorizationHeader(): Promise<string> {
        return `Bearer ${await this.accessToken()}`;
    }

    private async accessToken(): Promise<string> {
        const now = Date.now() / 1000;
        if (!this._token || <number>this._expire_token_time < now) {
            const body = {'secret_key': this._options.secretKey}
            const headers = {'Content-Type': 'application/json'}
            const post_url = `${this.eyepopUrl()}/authentication/token`
            const response = await fetch(post_url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
                // @ts-ignore
                dispatcher: this._dispatcher
            })
            if (response.status != 200) {
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
            const data = await response.json()
            const token: AccessToken = data as AccessToken
            this._token = token.access_token
            this._expire_token_time = now + token.expires_in - 60
        }
        return <string>this._token
    }

    private eyepopUrl(): string {
        if (this._options.eyepopUrl) {
            return this._options.eyepopUrl.replace(/\/+$/, '')
        } else {
            return 'https://api.eyepop.ai'
        }

    }
}