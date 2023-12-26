import {Options} from "./options";
import {Job, LoadFromJob, UploadJob} from "./jobs";

import fetch from 'node-fetch';

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
    private _token: string|null;
    private _expire_token_time: number|null;
    private _baseUrl: string|null;
    private _pipelineId: string|null;

    constructor(options: Options) {
        this._options = options;
        this._baseUrl = null;
        this._pipelineId = null;
        this._token = null;
        this._expire_token_time = null;
    }

    public open() {
        this.connect();
    }

    public close() {
        this.disconnect();
    }

    public upload(location: string): Job {
        return new UploadJob(location);
    }

    public loadFrom(location: string): Job {
        return new LoadFromJob(location);
    }

    protected connect() {
        const config_url = '${this._options.eyepopUrl}/pops/${this._options.popId}/config?auto_start=${this._options.autoStart}';
            fetch(config_url)
                .then((response) => response.json())
                .then((data) => {
                    const config: PopConfig = data as PopConfig
                    this._baseUrl = config.base_url;
                    this._pipelineId = config.pipeline_id;
                });
    }

    protected disconnect() {

    }

    protected authorizationHeader(): string {
        return 'Bearer ${this.accessToken()}';
    }

    private accessToken(): string {
        const now = Date.now() / 1000;
        if (!this._token || <number>this._expire_token_time < now) {
             const body = {
                'secret_key': this._options.secretKey
            }
            const headers = {
                'Content-Type': 'application/json'
            };
            const post_url = '${this._options.eyepopUrl}/authentication/token'

            fetch(post_url,{method:'POST', headers: headers, body: JSON.stringify(body)})
                .then((response) => response.json())
                .then((data) => {
                    const token = <AccessToken>data;
                    this._token = token.access_token;
                    this._expire_token_time = now / 1000 + token.expires_in - 60;
                });
        }
        return <string>this._token;
    }
}