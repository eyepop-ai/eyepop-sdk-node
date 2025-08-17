import { Prediction } from '../types'
import {Stream, StreamEvent, readableStreamFromString} from '../streaming'
import {Logger} from 'pino'
import { ComponentParams, ResultStream, VideoMode, WorkerSession } from '../worker/worker_types'
import { HttpClient } from '../options'
import {WebrtcWhip} from "EyePop/worker/webrtc_whip";

export class AbstractJob implements ResultStream {
    protected _getSession: () => Promise<WorkerSession>

    protected _params: ComponentParams[] | null

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

    protected constructor(params: ComponentParams[] | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        this._getSession = getSession
        this._params = params ?? null
        this._client = client
        this._requestLogger = requestLogger
    }

    protected async startJob(): Promise<Response> {
        return Promise.reject('abstract class')
    }

    protected async onEvent(event: StreamEvent): Promise<void> {
        if (event.type == "error") {
            return Promise.reject(`Error event for source ${event.source_id}: ${event.message}`)
        }
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
                        } else if (response.body) {
                            resolve(response.body)
                            break
                        } else {
                            const text = await response.text();
                            if (text) {
                                resolve(readableStreamFromString(text));
                                break
                            } else {
                                reject('response body is empty')
                                break
                            }
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
    private readonly _uploadStream: ReadableStream<Uint8Array> | Blob | BufferSource
    private readonly _mimeType: string
    private readonly _size: number | undefined
    private readonly _needsFullDuplex: boolean
    private readonly _videoMode: VideoMode | undefined
    get [Symbol.toStringTag](): string {
        return 'uploadJob'
    }

    constructor(stream: ReadableStream<Uint8Array> | Blob | BufferSource, mimeType: string, size: number | undefined, videoMode: VideoMode | undefined, params: ComponentParams[] | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._uploadStream = stream
        this._mimeType = mimeType
        this._size = size
        this._videoMode = videoMode
        this._needsFullDuplex = !client.isFullDuplex() && mimeType.startsWith('video/') && videoMode == VideoMode.STREAM
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
            const videoModeQuery = this._videoMode ? `&videoMode=${this._videoMode}` : ''
            const postUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=queue&processing=async&sourceId=${event.source_id}${videoModeQuery}`
            if (this._params) {
                const params = JSON.stringify(this._params)
                const paramBlob = new Blob([params], { type: 'application/json' })
                const formData = new FormData()
                const fileBlob = await new Response(this._uploadStream).blob();
                formData.append('params', paramBlob)
                formData.append('file', fileBlob)
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
                    eyepop: { responseStreaming: true }
                })
            } else {
                const headers = {
                    ...session.authenticationHeaders(),
                    Accept: 'application/jsonl',
                    'Content-Type': this._mimeType,
                }
                if (this._size) {
                    headers['Content-Length'] = `${this._size}`
                }
                request = this._client.fetch(postUrl, {
                    headers: headers,
                    method: 'POST',
                    body: this._uploadStream,
                    signal: this._controller.signal,
                    // @ts-ignore
                    duplex: 'half',
                    eyepop: { responseStreaming: true }
                })
            }
            request
                .then(async value => {
                    if (value.status != 204) {
                        this._requestLogger.debug(`unexpected status ${value.status} (${await value.text()}) for POST ${postUrl}`)
                    }
                })
                .catch(reason => {
                    this._requestLogger.debug(`error ${reason} for POST ${postUrl}`)
                })
        }
        return Promise.resolve()
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        if (!session.baseUrl) {
            return Promise.reject('session.baseUrl must not be null')
        }
        let response
        if (this._needsFullDuplex) {
            const prepareUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/prepareSource?timeout=10s`
            const headers = {
                ...session.authenticationHeaders(),
                Accept: 'application/jsonl'
            }
            response = await this._client.fetch(prepareUrl, {
                headers: headers,
                method: 'POST',
                signal: this._controller.signal,
                // @ts-ignore
                duplex: 'half',
                eyepop: { responseStreaming: true }
            })
        } else {
            const videoModeQuery = this._videoMode ? `&videoMode=${this._videoMode}` : ''
            const postUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=queue&processing=sync${videoModeQuery}`
            if (this._params) {
                const params = JSON.stringify(this._params)
                const paramBlob = new Blob([params], { type: 'application/json' })
                const formData = new FormData()
                const fileBlob = await new Response(this._uploadStream).blob();
                formData.append('params', paramBlob)
                formData.append('file', fileBlob)
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
                    eyepop: { responseStreaming: true }
                })
            } else {
                const headers = {
                    ...session.authenticationHeaders(),
                    Accept: 'application/jsonl',
                    'Content-Type': this._mimeType,
                }
                if (this._size) {
                    headers['Content-Length'] = `${this._size}`
                }
                response = await this._client.fetch(postUrl, {
                    headers: headers,
                    method: 'POST',
                    body: this._uploadStream,
                    signal: this._controller.signal,
                    // @ts-ignore
                    duplex: 'half',
                })
            }
        }
        return response
    }
}

export class LoadFromJob extends AbstractJob {
    private readonly _location: string

    constructor(location: string, params: ComponentParams[] | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
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
        return await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal,
            // @ts-ignore
            eyepop: { responseStreaming: true },
        })
    }
}

export class LoadFromAssetUuidJob extends AbstractJob {
    private readonly _assetUuid: string

    constructor(assetUuid: string, params: ComponentParams[] | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._assetUuid = assetUuid
    }

    get [Symbol.toStringTag](): string {
        return 'loadFromAssetUuidJob'
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        if (!session.baseUrl) {
            return Promise.reject('session.baseUrl must not ne null')
        }
        const body = {
            sourceType: 'ASSET_UUID',
            assetUuid: this._assetUuid,
            params: this._params,
        }
        const headers = {
            ...session.authenticationHeaders(),
            Accept: 'application/jsonl',
            'Content-Type': 'application/json',
        }
        const patchUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=queue&processing=sync`
        return await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal,
            // @ts-ignore
            eyepop: { responseStreaming: true },
        })
    }
}

export class LoadLiveIngressJob extends AbstractJob {
    private readonly _ingressId: string

    constructor(ingressId: string, params: ComponentParams[] | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
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
        return await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal,
            // @ts-ignore
            eyepop: { responseStreaming: true }
        })
    }
}

export class LoadMediaStreamJob extends AbstractJob {
    private readonly _mediaStream: MediaStream

    constructor(mediaStream: MediaStream, params: ComponentParams[] | undefined, getSession: () => Promise<WorkerSession>, client: HttpClient, requestLogger: Logger) {
        super(params, getSession, client, requestLogger)
        this._mediaStream = mediaStream
    }

    get [Symbol.toStringTag](): string {
        return 'loadLiveIngressJob'
    }

    protected override async startJob(): Promise<Response> {
        const session = await this._getSession()
        if (!session.baseUrl) {
            return Promise.reject('session.baseUrl must not ne null')
        }

        const whip = new WebrtcWhip(
            this._mediaStream,
            async () => {
                return session
            },
            this._client,
            true,
            this._requestLogger,
        )

        whip.start().then(value => {
            this._requestLogger.debug("direct whip for ingressId=%s successful", whip.ingressId())
        }).catch(reason => {
            this._controller.abort(reason)
        })

        const body = {
            sourceType: 'WHIP',
            whipIngressId: whip.ingressId(),
            params: this._params,
        }
        const headers = {
            ...session.authenticationHeaders(),
            Accept: 'application/jsonl',
            'Content-Type': 'application/json',
        }
        const patchUrl: string = `${session.baseUrl.replace(/\/+$/, '')}/pipelines/${session.pipelineId}/source?mode=preempt&processing=sync`
        return await this._client.fetch(patchUrl, {
            headers: headers,
            method: 'PATCH',
            body: JSON.stringify(body),
            signal: this._controller.signal,
            // @ts-ignore
            eyepop: { responseStreaming: true }
        })
    }
}
