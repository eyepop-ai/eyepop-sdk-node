import { Prediction, SourceParams } from '../types'
import { Stream, StreamEvent } from '../streaming'
import { HttpClient } from '../shims/http_client'

import { Logger } from 'pino'
import { ResultStream, WorkerSession } from '../worker/worker_types'

export class AbstractJob implements ResultStream {
    protected _getSession: () => Promise<WorkerSession>

    protected _params: SourceParams | null

    protected _responseStream: Promise<ReadableStream<Uint8Array>> | null = null
    protected _controller: AbortController = new AbortController()

    protected _client: HttpClient

    protected _requestLogger: Logger;

    [Symbol.asyncIterator](): AsyncIterator<Prediction> {
        if (!this._responseStream) {
            throw Error('logical bug')
        }
        return Stream.iterFromReadableStream(this._responseStream, this._controller, async (event: StreamEvent) => {
            return await this.onEvent(event)
        })
    }

    protected constructor(params: SourceParams | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        this._getSession = getSession
        this._params = params ?? null
        this._client = client
        this._requestLogger = requestLogger
    }

    protected async startJob(): Promise<Response> {
        return Promise.reject('abstract class')
    }

    protected async onEvent(event: StreamEvent): Promise<void> {
        return Promise.resolve()
    }

    static n: number = 0

    public start(done: () => void, status: (statusCode: number) => void): AbstractJob {
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
            } catch (reason) {
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
    private readonly _mimeType: string
    private readonly _needsFullDuplex: boolean

    get [Symbol.toStringTag](): string {
        return 'uploadJob'
    }

    constructor(stream: any, mimeType: string, params: SourceParams | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._uploadStream = stream
        this._mimeType = mimeType
        this._needsFullDuplex = mimeType.startsWith('video/')
    }

    protected override async onEvent(event: StreamEvent): Promise<void> {
        if (event.type == 'prepared') {
            if (!event.source_id) {
                return Promise.reject('did not get a prepared sourceId to simulate full duplex')
            }
            const session = await this._getSession()
            if (!session.baseUrl) {
                return Promise.reject('session.baseUrl must not ne null')
            }
            let request
            const postUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=queue&processing=async&sourceId=${event.source_id}`
            if (this._params) {
                this._requestLogger.debug('before POST %s with multipart body because of params', postUrl)
                const params = JSON.stringify(this._params)
                const paramBlob = new Blob([params], { type: 'application/json' })
                const formData = new FormData()
                formData.append('params', paramBlob)
                formData.append('file', this._uploadStream)

                const headers = {
                    ...session.authenticationHeaders(),
                    Accept: 'application/jsonl',
                }

                request = this._client.fetch(postUrl, {
                    headers: headers,
                    method: 'POST',
                    body: formData,
                    signal: this._controller.signal,
                    // @ts-ignore
                    duplex: 'half',
                })
            } else {
                this._requestLogger.debug('before POST %s with stream as body', postUrl)
                const headers = {
                    ...session.authenticationHeaders(),
                    Accept: 'application/jsonl',
                    'Content-Type': this._mimeType,
                }
                request = this._client.fetch(postUrl, {
                    headers: headers,
                    method: 'POST',
                    body: this._uploadStream,
                    signal: this._controller.signal,
                    // @ts-ignore
                    duplex: 'half',
                })
            }
            request
                .then(async value => {
                    if (value.status != 204) {
                        this._requestLogger.debug('unexpected status %d (%s) for POST %s ', value.status, await value.text(), postUrl)
                    }
                })
                .catch(reason => {
                    this._requestLogger.debug('error %v for POST %s ', reason, postUrl)
                })
                .finally(() => {
                    this._requestLogger.debug('after POST %s ', postUrl)
                })
            // if (response.status != 204) {
            //     return Promise.reject(`upload error ${response.status}: ${await response.text()}`)
            // }
        }
        return Promise.resolve()
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        if (!session.baseUrl) {
            return Promise.reject('session.baseUrl must not ne null')
        }
        let response
        if (this._needsFullDuplex) {
            const prepareUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/prepareSource?timeout=10s`
            const headers = {
                ...session.authenticationHeaders(),
                Accept: 'application/jsonl',
            }
            this._requestLogger.debug('before POST %s to prepare full duplex upload', prepareUrl)
            response = await this._client.fetch(prepareUrl, {
                headers: headers,
                method: 'POST',
                signal: this._controller.signal,
                // @ts-ignore
                duplex: 'half',
            })
            this._requestLogger.debug('after POST %s to prepare full duplex upload', prepareUrl)
        } else {
            const postUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=queue&processing=sync`
            if (this._params) {
                this._requestLogger.debug('before POST %s with multipart body because of params', postUrl)
                const params = JSON.stringify(this._params)
                const paramBlob = new Blob([params], { type: 'application/json' })
                const formData = new FormData()
                formData.append('params', paramBlob)
                formData.append('file', this._uploadStream)

                const headers = {
                    ...session.authenticationHeaders(),
                    Accept: 'application/jsonl',
                }

                response = await this._client.fetch(postUrl, {
                    headers: headers,
                    method: 'POST',
                    body: formData,
                    signal: this._controller.signal,
                    // @ts-ignore
                    duplex: 'half',
                })
                this._requestLogger.debug('after POST %s with multipart body because of params', postUrl)
            } else {
                this._requestLogger.debug('before POST %s with stream as body', postUrl)
                const headers = {
                    ...session.authenticationHeaders(),
                    Accept: 'application/jsonl',
                    'Content-Type': this._mimeType,
                }
                response = await this._client.fetch(postUrl, {
                    headers: headers,
                    method: 'POST',
                    body: this._uploadStream,
                    signal: this._controller.signal,
                    // @ts-ignore
                    duplex: 'half',
                })
                this._requestLogger.debug('after POST %s with stream as body', postUrl)
            }
        }
        return response
    }
}

export class LoadFromJob extends AbstractJob {
    private readonly _location: string

    constructor(location: string, params: SourceParams | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._location = location
    }

    get [Symbol.toStringTag](): string {
        return 'loadFromJob'
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        if (!session.baseUrl) {
            return Promise.reject('session.baseUrl must not ne null')
        }
        const body = {
            sourceType: 'URL',
            url: this._location,
            params: this._params,
        }
        const headers = {
            ...session.authenticationHeaders(),
            Accept: 'application/jsonl',
            'Content-Type': 'application/json',
        }
        const patchUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=queue&processing=sync`
        this._requestLogger.debug('before PATCH %s with url %s as source', patchUrl, this._location)
        const response = await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal,
        })
        this._requestLogger.debug('after PATCH %s with url %s as source', patchUrl, this._location)
        return response
    }
}

export class LoadLiveIngressJob extends AbstractJob {
    private readonly _ingressId: string

    constructor(ingressId: string, params: SourceParams | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._ingressId = ingressId
    }

    get [Symbol.toStringTag](): string {
        return 'loadLiveIngressJob'
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        if (!session.baseUrl) {
            return Promise.reject('session.baseUrl must not ne null')
        }
        const body = {
            sourceType: 'LIVE_INGRESS',
            liveIngressId: this._ingressId,
            params: this._params,
        }
        const headers = {
            ...session.authenticationHeaders(),
            Accept: 'application/jsonl',
            'Content-Type': 'application/json',
        }
        const patchUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=preempt&processing=sync`
        this._requestLogger.debug('before PATCH %s with url %s as source', patchUrl, this._ingressId)
        const response = await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal,
        })
        this._requestLogger.debug('after PATCH %s with url %s as source', patchUrl, this._ingressId)
        return response
    }
}
