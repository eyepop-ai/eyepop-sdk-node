import {Options} from "./options"
import {ResultStream, LoadFromJob, UploadJob} from "./jobs"
import {createHttpClient, HttpClient} from './shims/http_client'

import {Semaphore} from 'await-semaphore'
import {Logger, pino} from "pino"
import * as fs from "node:fs"
import * as stream from "node:stream"
import * as mime from "mime-types"


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

    private _client: HttpClient | null

    private _limit: Semaphore | null

    private _logger: Logger
    private readonly _requestLogger: Logger

    constructor(options: Options) {
        this._options = options
        this._baseUrl = null
        this._pipelineId = null
        this._token = null
        this._expire_token_time = null
        this._client = null
        this._limit = null
        let rootLogger
        if (options.logger) {
            rootLogger = options.logger
        } else {
            rootLogger = pino()
        }
        this._logger = rootLogger.child({module: 'eyepop'})
        this._requestLogger = this._logger.child({module: 'requests'})
    }

    public async upload(params: UploadParams): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
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
        let release = await this._limit.acquire()
        const job = new UploadJob(stream, mimeType, this._baseUrl, this._pipelineId, await this.authorizationHeader(),
            this._client, this._requestLogger)
        return job.start(release)
    }

    public async loadFrom(location: string): Promise<ResultStream> {
        if (!this._baseUrl || !this._pipelineId || !this._client || !this._limit) {
            throw new Error("endpoint not connected, use open() before loadFrom()")
        }
        const release = await this._limit.acquire()
        const job = new LoadFromJob(location, this._baseUrl, this._pipelineId, await this.authorizationHeader(),
            this._client, this._requestLogger)
        return job.start(release)
    }

    // noinspection TypeScriptValidateTypes
    public async connect(): Promise<Endpoint> {
        if (this._client) {
            console.info('endpoint already connected')
            return this
        }
        if (!this._options.eyepopUrl) {
            return Promise.reject("option eyepopUrl or environment variable EYEPOP_URL is required")
        }
        if (!this._options.popId) {
            return Promise.reject("option popId or environment variable EYEPOP_POP_ID is required")
        }
        if (!this._options.secretKey) {
            return Promise.reject("option secretKey or environment variable EYEPOP_SECRET_KEY is required")
        }

        this._client = await createHttpClient()

        // @ts-ignore
        this._limit = new Semaphore(this._options.jobQueueLength)

        const config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=${this._options.autoStart}`
        const headers = {
            'Authorization': await this.authorizationHeader()
        }
        this._requestLogger.debug('before GET %s', config_url)
        let response = await this._client.fetch(config_url, {headers: headers})
        if (response.status == 401) {
            this._requestLogger.debug('after GET %s: 401, about to retry with fresh access token', config_url)
            // one retry, the token might have just expired
            this._token = null
            const headers = {
                'Authorization': await this.authorizationHeader()
            }
            response = await this._client.fetch(config_url, {
                headers: headers, // @ts-ignore
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
        this._requestLogger.debug('after GET %s: %s / %s', config_url, this._baseUrl, this._pipelineId)
        if (!this._pipelineId || !this._baseUrl) {
            return Promise.reject(`Pop not started`)
        }
        this._baseUrl = this._baseUrl.replace(/\/+$/, "")

        if (this._options.stopJobs) {
            const stop_url = `${this._baseUrl}/pipelines/${this._pipelineId}/source?mode=preempt&processing=sync`
            const body = {'sourceType': 'NONE'}
            const headers = {
                'Authorization': await this.authorizationHeader(), 'Content-Type': 'application/json'
            }
            this._requestLogger.debug('before PATCH %s', stop_url)
            let response = await this._client.fetch(stop_url, {method: 'PATCH', headers: headers, body: JSON.stringify(body)})
            if (response.status >= 300) {
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
            this._requestLogger.debug('after PATCH %s', stop_url)
        }
        return this;
    }

    public async disconnect(wait: boolean = true): Promise<void> {
        if (wait && this._limit) {
            // @ts-ignore
            for (let i = 0; i < this._options.jobQueueLength; i++) {
                await this._limit.acquire()
            }
        }
        if (this._client) {
            await this._client.close()
            this._client = null
        }
        this._baseUrl = null
        this._pipelineId = null
        this._limit = null
    }

    protected async authorizationHeader(): Promise<string> {
        return `Bearer ${await this.accessToken()}`;
    }

    private async accessToken(): Promise<string> {
        const now = Date.now() / 1000;
        if (!this._token || <number>this._expire_token_time < now) {
            if (!this._client) {
                return Promise.reject("endpoint not connected")
            }

            const body = {'secret_key': this._options.secretKey}
            const headers = {'Content-Type': 'application/json'}
            const post_url = `${this.eyepopUrl()}/authentication/token`
            this._requestLogger.debug('before POST %s', post_url)
            const response = await this._client.fetch(post_url, {
                method: 'POST', headers: headers, body: JSON.stringify(body)
            })
            if (response.status != 200) {
                const message = await response.text()
                return Promise.reject(`Unexpected status ${response.status}: ${message}`)
            }
            this._requestLogger.debug('after POST %s', post_url)
            const data = await response.json()
            const token: AccessToken = data as AccessToken
            this._token = token.access_token
            this._expire_token_time = now + token.expires_in - 60
        }
        this._logger.debug('using access token, valid for at least %d seconds', <number>this._expire_token_time - now)
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