import {Prediction} from "./types"
import {Stream} from "./streaming"


export interface Job {
    start(): Promise<void>
    stream(): Promise<AsyncIterable<Prediction>>
    cancel(): Promise<void>
}

export class AbstractJob implements Job {
    protected _baseUrl: string
    protected _pipelineId: string
    protected _authorizationHeader: string

    protected _responseStream: any | null = null
    protected _controller: AbortController = new AbortController()

    protected constructor(baseUrl: string, pipelineId: string, authorizationHeader: string) {
        this._baseUrl = baseUrl.replace(/\/+$/, "")
        this._pipelineId = pipelineId
        this._authorizationHeader = authorizationHeader
    }

    protected async _fetch(): Promise<Response> {
        return Promise.reject("abstract class")
    }

    public async start(): Promise<void> {
        const response = await this._fetch()
        if (response.status != 200) {
            throw Error(`upload error ${response.status}: ${await response.text()}`)
        }
        this._responseStream = response.body
        this._controller.signal.addEventListener('abort', async (event) => {
            if (response.body) {
                await response.body.cancel()
            }
        })
    }

    async stream(): Promise<AsyncIterable<Prediction>> {
        if (!this._responseStream) {
            throw Error(`response body is empty`)
        }
        return Stream.fromReadableStream(this._responseStream, this._controller);
    }

    async cancel(): Promise<void> {
        return this._controller.abort('cancelled')
    }
}

export class UploadJob extends AbstractJob {
    private _uploadStream: ReadableStream<Uint8Array>
    private _mimeType: string

    constructor(stream: any, mimeType: string, baseUrl: string, pipelineId: string, authorizationHeader: string) {
        super(baseUrl, pipelineId, authorizationHeader)
        this._uploadStream = stream
        this._mimeType = mimeType
    }

    protected override async _fetch(): Promise<Response> {
        const headers = {
            'Authorization': this._authorizationHeader,
            'Accept': 'application/jsonl',
            'Content-Type': this._mimeType
        }
        const postUrl: string = `${this._baseUrl}/pipelines/${this._pipelineId}/source?mode=queue&processing=sync`
        return await fetch(postUrl, {
            headers: headers,
            method: 'POST',
            body: this._uploadStream,
            // @ts-ignore
            'duplex': 'half'
        })
    }
}

export class LoadFromJob extends AbstractJob {
    private _location: string;
    constructor(location: string, baseUrl: string, pipelineId: string, authorizationHeader: string) {
        super(baseUrl, pipelineId, authorizationHeader)
        this._location = location
    }

    protected override async _fetch(): Promise<Response> {
        const headers = {
            'Authorization': this._authorizationHeader,
            'Accept': 'application/jsonl',
            'Content-Type': 'application/json'
        }
        const body = {
            'sourceType': 'URL',
            'url': this._location
        }
        const postUrl: string = `${this._baseUrl}/pipelines/${this._pipelineId}/source?mode=queue&processing=sync`
        return await fetch(postUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            keepalive: true,
        })
    }
}