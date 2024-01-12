import {Prediction} from "./types";
import {Stream} from "./streaming";
import {ReadStream} from "fs";

export interface Job {
    stream(): Promise<AsyncIterable<Prediction>>
}

export class UploadJob implements Job {
    private _uploadStream: ReadStream
    private _baseUrl: string
    private _pipelineId: string
    private _authorizationHeader: string
    private _responseStream: ReadableStream|null

    constructor(stream: ReadStream, baseUrl: string, pipelineId: string, authorizationHeader: string) {
        this._uploadStream = stream
        this._baseUrl = baseUrl
        this._pipelineId = pipelineId
        this._authorizationHeader = authorizationHeader
        this._responseStream = null
    }

    async start() {
        const headers = {
            'Authorization': this._authorizationHeader,
            'Content-Type': 'application/octet-stream'
        }

        const postUrl: string = `${this._baseUrl}pipelines/${this._pipelineId}/source?mode=queue&processing=sync`
        console.log(postUrl)
        const response = await fetch(postUrl, {
            headers: headers,
            method: 'POST',
            // @ts-ignore
            body: this._uploadStream,
            // @ts-ignore
            duplex: 'half'
        })
        if (response.status != 200) {
            throw Error(`upload error ${response.status}: ${await response.text()}`)
        }
        this._responseStream = response.body
    }
    async stream(): Promise<AsyncIterable<Prediction>> {
        if (!this._responseStream) {
            throw Error(`upload error, response body is empty`)
        }
        let controller: AbortController = new AbortController()

        return Stream.fromReadableStream(this._responseStream, controller);
    }
}

export class LoadFromJob  {
    private _location: string;
    constructor(location: string) {
        this._location = location;
    }
}