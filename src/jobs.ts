import {Prediction} from "./types"
import {Stream} from "./streaming"
import {Dispatcher} from 'undici'
import {Logger} from "pino"

export interface ResultStream extends AsyncIterable<Prediction> {
    cancel(): void
}

export class AbstractJob implements ResultStream {
    protected _baseUrl: string
    protected _pipelineId: string
    protected _authorizationHeader: string

    protected _responseStream: Promise<ReadableStream<Uint8Array>> | null = null
    protected _controller: AbortController = new AbortController()

    protected _dispatcher: Dispatcher

    protected _requestLogger: Logger

    [Symbol.asyncIterator](): AsyncIterator<Prediction> {
        if (!this._responseStream) {
            throw Error('logical bug')
        }
        return Stream.iterFromReadableStream(this._responseStream, this._controller)
    }

    protected constructor(baseUrl: string, pipelineId: string, authorizationHeader: string, dispatcher: Dispatcher, requestLogger: Logger) {
        this._baseUrl = baseUrl.replace(/\/+$/, "")
        this._pipelineId = pipelineId
        this._authorizationHeader = authorizationHeader
        this._dispatcher = dispatcher
        this._requestLogger = requestLogger
        this.i = AbstractJob.n++
    }

    protected async _fetch(): Promise<Response> {
        return Promise.reject("abstract class")
    }

    static n: number = 0
    private i: number

    public start(done: () => void): AbstractJob {
        this._responseStream = new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
            const request = this._fetch()
            request.then(response => {
                if (response.status != 200) {
                    reject(`upload error ${response.status}: ${response.text()}`)
                } else if (!response.body) {
                    reject(`response body is empty`)
                } else {
                    resolve(response.body)
                }
            }).catch(reason => {
                reject(reason)
            }).finally(() => {
                done()
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

    get [Symbol.toStringTag](): string {
        return 'uploadJob'
    }

    constructor(stream: any, mimeType: string, baseUrl: string, pipelineId: string, authorizationHeader: string, dispatcher: Dispatcher, requestLogger: Logger) {
        super(baseUrl, pipelineId, authorizationHeader, dispatcher, requestLogger)
        this._uploadStream = stream
        this._mimeType = mimeType
    }

    protected override async _fetch(): Promise<Response> {
        const headers = {
            'Authorization': this._authorizationHeader, 'Accept': 'application/jsonl', 'Content-Type': this._mimeType
        }
        const postUrl: string = `${this._baseUrl}/pipelines/${this._pipelineId}/source?mode=queue&processing=sync`
        this._requestLogger.debug("before POST %s with stream as body")
        const response = await fetch(postUrl, {
            headers: headers, method: 'POST', body: this._uploadStream, signal: this._controller.signal, // @ts-ignore
            'duplex': 'half', dispatcher: this._dispatcher
        })
        this._requestLogger.debug("after POST %s with stream as body")
        return response
    }
}

export class LoadFromJob extends AbstractJob {
    private _location: string;

    constructor(location: string, baseUrl: string, pipelineId: string, authorizationHeader: string, dispatcher: Dispatcher, requestLogger: Logger) {
        super(baseUrl, pipelineId, authorizationHeader, dispatcher, requestLogger)
        this._location = location
    }

    get [Symbol.toStringTag](): string {
        return 'loadFromJob'
    }

    protected override async _fetch(): Promise<Response> {
        const headers = {
            'Authorization': this._authorizationHeader,
            'Accept': 'application/jsonl',
            'Content-Type': 'application/json'
        }
        const body = {
            'sourceType': 'URL', 'url': this._location
        }

        const postUrl: string = `${this._baseUrl}/pipelines/${this._pipelineId}/source?mode=queue&processing=sync`
        this._requestLogger.debug("before PATCH %s with url %s as source", postUrl, this._location)
        const response = await fetch(postUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal, // @ts-ignore
            dispatcher: this._dispatcher
        })
        this._requestLogger.debug("after PATCH %s with url %s as source", postUrl, this._location)
        return response

    }
}