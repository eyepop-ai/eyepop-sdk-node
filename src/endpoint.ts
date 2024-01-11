import {Options} from "./options";
import {Job, LoadFromJob, UploadJob} from "./jobs";

interface PopConfig {
    base_url: string;
    pipeline_id: string;
}

interface AccessToken {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export class Endpoint {

    private _options: Options;
    private _token: string | null;
    private _expire_token_time: number | null;
    private _baseUrl: string | null;
    private _pipelineId: string | null;

    constructor(options: Options) {
        this._options = options;
        this._baseUrl = null;
        this._pipelineId = null;
        this._token = null;
        this._expire_token_time = null;
    }

    public async open() {
        await this.connect()
    }

    public async close() {
        await this.disconnect()
    }

    public upload(location: string): Job {
        return new UploadJob(location);
    }

    public loadFrom(location: string): Job {
        return new LoadFromJob(location);
    }

    protected async connect() {
        const config_url = `${this.eyepopUrl()}/pops/${this._options.popId}/config?auto_start=${this._options.autoStart}`
        const headers = {
            'Authorization': await this.authorizationHeader()
        }
        const response = await fetch(config_url, {headers: headers})
        const data = await response.json()
        const config: PopConfig = data as PopConfig
        this._baseUrl = config.base_url;
        this._pipelineId = config.pipeline_id;
    }

    protected disconnect() {

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
            const response = await fetch(post_url, {method: 'POST', headers: headers, body: JSON.stringify(body)})
            if (response.status != 200) {
                const message = await response.text()
                return new Promise<string>((resolve, reject) => {
                    reject(new Error(`Unexpected status ${response.status}: ${message}`))
                })
            }
            const data = await response.json()
            const token: AccessToken = data as AccessToken
            this._token = token.access_token
            this._expire_token_time = now / 1000 + token.expires_in - 60
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