import {Prediction, ResultStream, WorkerSession, SourceParams} from "./types"
import {Stream} from "./streaming"
import {HttpClient} from './shims/http_client'

import {Logger} from "pino"

export class AbstractJob implements ResultStream {
    protected _getSession: () => Promise<WorkerSession>

    protected _params: SourceParams | null

    protected _responseStream: Promise<ReadableStream<Uint8Array>> | null = null
    protected _controller: AbortController = new AbortController()

    protected _client: HttpClient

    protected _requestLogger: Logger

    [Symbol.asyncIterator](): AsyncIterator<Prediction> {
        if (!this._responseStream) {
            throw Error('logical bug')
        }
        return Stream.iterFromReadableStream(this._responseStream, this._controller)
    }

    protected constructor(params: SourceParams | undefined, getSession: () => Promise<WorkerSession>,
                          client: HttpClient, requestLogger: Logger) {
        this._getSession = getSession
        this._params = params ?? null
        this._client = client
        this._requestLogger = requestLogger
    }

    protected async startJob(): Promise<Response> {
        return Promise.reject("abstract class")
    }

    static n: number = 0

    public start(done: () => void, status: (statusCode:number) => void): AbstractJob {
        this._responseStream = new Promise<ReadableStream<Uint8Array>>(async (resolve, reject) => {
            try {
                let retries = 1
                while (true) {
                    try {
                        const response = await this.startJob()
                        if (response.status == 401) {
                            status(response.status)
                            if (retries--) {
                                this._requestLogger.info('received 401 response, attempt to reauthorize once')
                            } else {
                                reject(`response ${response.status}: ${response.statusText}`)
                                break
                            }
                        } else if (response.status == 404) {
                            status(response.status)
                            if (retries--) {
                                this._requestLogger.info('received 404 response, attempt to restart pop')
                            } else {
                                reject(`response ${response.status}: ${response.statusText}`)
                                break
                            }
                        } else if (response.status != 200) {
                            reject(`upload error ${response.status}: ${await response.text()}`)
                            break
                        } else if (!response.body) {
                            reject(`response body is empty`)
                            break
                        } else {
                            resolve(response.body)
                            break
                        }
                    } catch (error) {
                        if (retries--) {
                            this._requestLogger.info('unknown, attempt to restart pop (as if we received 404)', error)
                            status(404)
                        } else {
                            status(500)
                            reject(error)
                            break
                        }
                    }
                }
            } catch(reason) {
                reject(reason)
            } finally {
                done()
            }
        })
        return this
    }

    public cancel(): void {
        this._controller.abort('cancelled')
    }
}

export class UploadJob extends AbstractJob {
    private readonly _uploadStream: Blob
    private readonly  _mimeType: string

    get [Symbol.toStringTag](): string {
        return 'uploadJob'
    }

    constructor(stream: any, mimeType: string, params: SourceParams | undefined,
                getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._uploadStream = stream
        this._mimeType = mimeType
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        const postUrl: string = `${session.baseUrl.replace(/\/+$/, "")}/pipelines/${session.pipelineId}/source?mode=queue&processing=sync`
        let response
        if (this._params) {
            this._requestLogger.debug("before POST %s with multipart body because of params")
            const params = JSON.stringify(this._params)
            const paramBlob = new Blob([params], { type: 'application/json' })
            const formData = new FormData()
            formData.append('params', paramBlob)
            formData.append('file', this._uploadStream)

            const headers = {
                'Authorization': `Bearer ${session.accessToken}`,
                'Accept': 'application/jsonl'
            }

            response = await this._client.fetch(postUrl, {
                headers: headers, method: 'POST', body: formData, signal: this._controller.signal, // @ts-ignore
                'duplex': 'half', dispatcher: this._dispatcher
            })
            this._requestLogger.debug("after POST %s with multipart body because of params")
        } else {
            this._requestLogger.debug("before POST %s with stream as body")
            const headers = {
                'Authorization': `Bearer ${session.accessToken}`,
                'Accept': 'application/jsonl',
                'Content-Type': this._mimeType
            }
            response = await this._client.fetch(postUrl, {
                headers: headers, method: 'POST', body: this._uploadStream, signal: this._controller.signal, // @ts-ignore
                'duplex': 'half', dispatcher: this._dispatcher
            })
            this._requestLogger.debug("after POST %s with stream as body")
        }

        return response
    }
}

export class LoadFromJob extends AbstractJob {
    private readonly _location: string;

    constructor(location: string, params: SourceParams | undefined,
                getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._location = location
    }

    get [Symbol.toStringTag](): string {
        return 'loadFromJob'
    }

    protected override async startJob(): Promise<Response> {
        const body = {
            'sourceType': 'URL',
            'url': this._location,
            'params': this._params
        }
        const session = await this._getSession()
        const headers = {
            'Authorization': `Bearer ${session.accessToken}`,
            'Accept': 'application/jsonl',
            'Content-Type': 'application/json'
        }
        const patchUrl: string = `${session.baseUrl.replace(/\/+$/, "")}/pipelines/${session.pipelineId}/source?mode=queue&processing=sync`
        this._requestLogger.debug("before PATCH %s with url %s as source", patchUrl, this._location)
        const response = await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal, // @ts-ignore
            dispatcher: this._dispatcher
        })
        this._requestLogger.debug("after PATCH %s with url %s as source", patchUrl, this._location)
        return response

    }
}

export class LoadLiveIngressJob extends AbstractJob {
    private readonly _ingressId: string;

    constructor(ingressId: string, params: SourceParams | undefined,
                getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._ingressId = ingressId
    }

    get [Symbol.toStringTag](): string {
        return 'loadLiveIngressJob'
    }

    protected override async startJob(): Promise<Response> {
        const body = {
            'sourceType': 'LIVE_INGRESS',
            'liveIngressId': this._ingressId,
            'params': this._params
        }
        const session = await this._getSession()
        const headers = {
            'Authorization': `Bearer ${session.accessToken}`,
            'Accept': 'application/jsonl',
            'Content-Type': 'application/json'
        }
        const patchUrl: string = `${session.baseUrl.replace(/\/+$/, "")}/pipelines/${session.pipelineId}/source?mode=preempt&processing=sync`
        this._requestLogger.debug("before PATCH %s with url %s as source", patchUrl, this._ingressId)
        const response = await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal, // @ts-ignore
            dispatcher: this._dispatcher
        })
        this._requestLogger.debug("after PATCH %s with url %s as source", patchUrl, this._ingressId)
        return response

    }
}