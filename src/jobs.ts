import {Prediction} from "./types"
import {Stream} from "./streaming"
import { Agent, Dispatcher } from 'undici'

export interface Job {
    results(): Promise<AsyncIterable<Prediction>>
    cancel(): void
}

export class AbstractJob implements Job {
    protected _baseUrl: string
    protected _pipelineId: string
    protected _authorizationHeader: string

    protected _responseStream: any | null = null
    protected _controller: AbortController = new AbortController()

    protected _dispatcher: Dispatcher

    protected _results: Promise<AsyncIterable<Prediction>> | undefined

    protected constructor(baseUrl: string, pipelineId: string, authorizationHeader: string, dispatcher: Dispatcher) {
        this._baseUrl = baseUrl.replace(/\/+$/, "")
        this._pipelineId = pipelineId
        this._authorizationHeader = authorizationHeader
        this._dispatcher = dispatcher
        this.i = AbstractJob.n++
    }

    public async results(): Promise<AsyncIterable<Prediction>> {
        if (!this._results) {
            return Promise.reject('job not started')
        }
        return this._results
    }

    protected async _fetch(): Promise<Response> {
        return Promise.reject("abstract class")
    }

    static n: number = 0
    private i : number
    public start(): AbstractJob {
        this._results = new Promise<AsyncIterable<Prediction>>((resolve, reject) => {
            const request = this._fetch()
            request.then(response => {
                if (response.status != 200) {
                    reject(`upload error ${response.status}: ${response.text()}`)
                }
                this._responseStream = response.body
                if (!this._responseStream) {
                    reject(`response body is empty`)
                }
                resolve(Stream.fromReadableStream(this._responseStream, this._controller))
            }).catch(reason => {
                reject(reason)
            }).finally(() => {
                // TODO
            })
        })
        return this
    }

    public cancel(): void {
        this._controller.abort('cancelled')
    }
}

export class UploadJob extends AbstractJob {
    private _uploadStream: ReadableStream<Uint8Array>
    private _mimeType: string

    get [Symbol.toStringTag]() : string {
        return 'uploadJob'
    }

    constructor(stream: any, mimeType: string, baseUrl: string, pipelineId: string, authorizationHeader: string, dispatcher: Dispatcher) {
        super(baseUrl, pipelineId, authorizationHeader, dispatcher)
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
            signal: this._controller.signal,
            // @ts-ignore
            'duplex': 'half',
            dispatcher: this._dispatcher
        })
    }
}

export class LoadFromJob extends AbstractJob {
    private _location: string;
    constructor(location: string, baseUrl: string, pipelineId: string, authorizationHeader: string, dispatcher: Dispatcher) {
        super(baseUrl, pipelineId, authorizationHeader, dispatcher)
        this._location = location
    }

        get [Symbol.toStringTag]() : string {
        return 'loadFromJob'
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
            signal: this._controller.signal,
            // @ts-ignore
            dispatcher: this._dispatcher
        })
    }
}