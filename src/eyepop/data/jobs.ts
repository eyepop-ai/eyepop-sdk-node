import { ResultStream } from '../worker/worker_types'
import { Logger } from 'pino'
import { Prediction } from '../types'
import { EvaluateRequest, EvaluateResponse, InferRequest, InferRunInfo } from './data_types'

type VlmFetch = (path: string, options: RequestInit) => Promise<any>

export class InferAssetJob implements ResultStream {
    protected _vlmFetch: VlmFetch
    protected _assetUrl: string
    protected _inferRequest: InferRequest

    protected _response: Promise<Prediction[]> | null = null
    protected _runInfo: InferRunInfo | null = null
    protected _controller: AbortController = new AbortController()

    protected _requestLogger: Logger;

    [Symbol.asyncIterator](): AsyncIterator<Prediction> {
        if (!this._response) {
            throw Error('logical bug')
        }
        let consumed = false
        const response_promise = this._response
        const controller = this._controller
        async function* iterator(): AsyncIterator<Prediction> {
            if (consumed) {
                throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.')
            }
            consumed = true
            let done = false
            try {
                const predictions = await response_promise
                if (predictions) {
                    for (let prediction of predictions) {
                        yield prediction
                    }
                }
                done = true
            } catch (e) {
                // If the user calls `stream.controller.abort()`, we should exit without throwing.
                if (e instanceof Error && e.name === 'AbortError') return
                throw e
            } finally {
                // If the user breaks, abort the ongoing request.
                if (!done) controller.abort()
            }
        }

        return iterator()
    }

    public constructor(assetUrl: string, inferRequest: InferRequest, vlmFetch: VlmFetch, requestLogger: Logger) {
        this._vlmFetch = vlmFetch

        this._assetUrl = assetUrl
        this._inferRequest = inferRequest

        this._requestLogger = requestLogger
    }

    public start(done: () => void): InferAssetJob {
        this._response = new Promise<Prediction[]>(async (resolve, reject) => {
            try {
                let requestId = null
                while (true) {
                    let response = null
                    if (requestId) {
                        response = await this._vlmFetch(`/api/v1/requests/${requestId}?timeout=20`, {
                            method: 'POST',
                        })
                    } else {
                        const infer_request = new Map(Object.entries(this._inferRequest))
                        infer_request.set('url', this._assetUrl)
                        const body = new FormData();
                        body.append('infer_request', JSON.stringify(Object.fromEntries(infer_request)))
                        response = await this._vlmFetch(`/api/v1/infer?timeout=20`, {
                            method: 'POST',
                            body: body,
                        })
                    }
                    const predictions = response['predictions']
                    const runInfo = response['run_info']
                    if (predictions) {
                        this._runInfo = runInfo
                        resolve(predictions)
                        break
                    } else {
                        requestId = response['request_id']
                        if (!requestId) {
                            reject(`missing request_id in response: ${JSON.stringify(response)}`)
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


export class EvaluateDatasetJob {
    protected _vlmFetch: VlmFetch
    protected _evaluateRequest: EvaluateRequest
    protected _workerRelease: string | null

    protected _response: Promise<EvaluateResponse> | null = null
    protected _controller: AbortController = new AbortController()

    protected _requestLogger: Logger;

    public async response(): Promise<EvaluateResponse> {
        if (!this._response) {
            throw Error('logical bug')
        }
        return await this._response
    }

    public constructor(evaluateRequest: EvaluateRequest, workerRelease: string | null, vlmFetch: VlmFetch, requestLogger: Logger) {
        this._vlmFetch = vlmFetch

        this._evaluateRequest = evaluateRequest
        this._workerRelease = workerRelease

        this._requestLogger = requestLogger
    }

    public start(done: () => void): EvaluateDatasetJob {
        this._response = new Promise<EvaluateResponse>(async (resolve, reject) => {
            try {
                let requestId = null
                while (true) {
                    let response = null
                    if (requestId) {
                        response = await this._vlmFetch(`/api/v1/evaluations/${requestId}?timeout=20`, {
                            method: 'GET',
                        })
                    } else {
                        const workerReleaseQuery = this._workerRelease? `&worker_release=${this._workerRelease}`: ''
                        response = await this._vlmFetch(`/api/v1/evaluations?timeout=20${workerReleaseQuery}`, {
                            method: 'POST',
                            body: JSON.stringify(this._evaluateRequest),
                            headers: { 'Content-Type': 'application/json' }
                        })
                    }
                    const runInfo = response['run_info']
                    if (runInfo) {
                        resolve(response)
                        break
                    } else {
                        requestId = response['request_id']
                        if (!requestId) {
                            reject(`missing request_id in response: ${JSON.stringify(response)}`)
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
