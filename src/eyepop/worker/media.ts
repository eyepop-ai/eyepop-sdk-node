/**
 * Reads of a recording by its mediaId (eyepop-instance spec 025): its range, a frame and a clip, over REST.
 *
 * A worker session reads from its own instance, `GET {session base url}/media/{mediaId}/range|frame|clip`; pipeline
 * mode reads from the pipeline API, `GET {pipeline API url}/api/v1/media/{mediaId}/range|frame|clip`, under the
 * endpoint's token. Both take the same parameters and give the same answers; only the pipeline API prices a read.
 *
 * Timestamps are the nanosecond PTS a prediction carries in `timestamp`, counted from the start of the source's
 * media. A JavaScript number holds them exactly up to 2^53 ns, about 104 days of media, so the reads take a
 * `number` (a safe integer) or a `bigint`, and answer `number`s.
 */
import { Logger } from 'pino'
import { HttpClient } from '../options'
import { PredictedObject, Prediction } from '../types'

/** A nanosecond timestamp: a safe integer, or a bigint for one past 2^53. */
export type Nanoseconds = number | bigint

/** The first and last nanosecond the media cache holds of a recording. */
export interface MediaRange {
    readonly startNs: number
    readonly endNs: number
}

/** A box in the frame's pixels: its left and top edges, its width and its height. */
export interface MediaBox {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/** How long a read waits for a moment the cache does not hold yet, on the server and in the SDK. */
export interface MediaWaitOptions {
    /** Milliseconds the server waits for the moment before it answers 425; 0 to 10000, the server's 2000 by default. */
    readonly waitMs?: number | undefined
    /**
     * Milliseconds the SDK keeps asking again after a 425, or a 503 `overloaded` from the pipeline API, each time
     * after its `Retry-After`; 30000 by default, 0 to not ask again. One still refused then throws `MediaReadError`.
     */
    readonly deadlineMs?: number | undefined
    /** Aborts the read, also while it waits to ask again. */
    readonly signal?: AbortSignal | undefined
}

export interface MediaFrameOptions extends MediaWaitOptions {
    /** Crop to this box in the frame's pixels, rounded out to whole pixels; the server clips it to the frame. */
    readonly bbox?: MediaBox | undefined
    /** Scale to fit this width, aspect kept and never enlarged. */
    readonly maxWidth?: number | undefined
    /** Scale to fit this height, aspect kept and never enlarged. */
    readonly maxHeight?: number | undefined
    /** PNG instead of JPEG, the default. */
    readonly png?: boolean | undefined
}

/** `exact` (the default) re-encodes the window to its exact bounds; `keyframe` copies it from the keyframe at or before its start. */
export type MediaClipMode = 'exact' | 'keyframe'

export interface MediaClipOptions extends MediaWaitOptions {
    readonly mode?: MediaClipMode | undefined
}

/** A clip: an MP4 that streams, and its real bounds. */
export interface MediaClip {
    /** The MP4's bytes as they arrive; read it to its end or cancel it. */
    readonly stream: ReadableStream<Uint8Array>
    /** The PTS of the clip's first frame, from `X-Start-Ns`; a keyframe clip may start before the asked start. */
    readonly startNs: number
    /** The PTS of the clip's last frame, from `X-End-Ns`. */
    readonly endNs: number
    /**
     * What the read cost on the pipeline API, from the clip's `X-Milli-Compute-Units` response header. Undefined
     * when the answer has none: on a worker session, whose reads are not priced.
     */
    readonly milliComputeUnits?: number | undefined
}

/** What reads a recording by mediaId: a `WorkerEndpoint`, in either mode. */
export interface MediaReader {
    mediaRange(mediaId: string, options?: { signal?: AbortSignal | undefined }): Promise<MediaRange>
    mediaFrame(mediaId: string, timestampNs: Nanoseconds, options?: MediaFrameOptions): Promise<Uint8Array>
    mediaClip(mediaId: string, startNs: Nanoseconds, endNs: Nanoseconds, options?: MediaClipOptions): Promise<MediaClip>
}

/**
 * A read by mediaId the server refused, or that the SDK gave up on: `status` is the HTTP status, and `error`,
 * `reason` and `serverMessage` the server's JSON fields when it sent them. `reason` is the code to act on:
 * `invalid_media_id`, `invalid_request`, `invalid_bbox`, `clip_too_long` (400), `no_account` (403),
 * `stream_not_found` (404), `media_expired` or `media_gap` (410), `media_not_yet_available` (425, once the SDK's
 * deadline passed; `retryAfterMs` is the server's last `Retry-After`), `media_cache_unreachable` (502),
 * `media_cache_not_configured`, `media_cache_scope_unresolved` or `overloaded` (503; an `overloaded` one only once
 * the SDK's deadline passed, with `retryAfterMs`). `cause` is the failure that kept the SDK from reading the
 * refusal's body, when one did.
 */
export class MediaReadError extends Error {
    readonly status: number
    readonly error: string | undefined
    readonly reason: string | undefined
    readonly serverMessage: string | undefined
    readonly retryAfterMs: number | undefined
    readonly cause: unknown

    constructor(
        status: number,
        fields: { error?: string | undefined; reason?: string | undefined; message?: string | undefined } = {},
        retryAfterMs: number | undefined = undefined,
        cause: unknown = undefined,
    ) {
        super(`media read failed with ${status}${fields.reason ? ` ${fields.reason}` : ''}${fields.message ? `: ${fields.message}` : ''}`)
        this.name = 'MediaReadError'
        this.status = status
        this.error = fields.error
        this.reason = fields.reason
        this.serverMessage = fields.message
        this.retryAfterMs = retryAfterMs
        this.cause = cause
    }
}

/** Why a job's `mediaFrame` cannot read a prediction's frame, before it asks: the job has no `mediaId`, or the prediction no `timestamp`. */
export type PredictionFrameErrorReason = 'no_media_id' | 'no_timestamp'

/** A job's `mediaFrame` that cannot be read before any request: `reason` says what is missing. */
export class PredictionFrameError extends Error {
    readonly reason: PredictionFrameErrorReason

    constructor(reason: PredictionFrameErrorReason, message: string) {
        super(message)
        this.name = 'PredictionFrameError'
        this.reason = reason
    }
}

/** Where a backend's reads go, and with what credential. */
export interface MediaRoute {
    /** The url the reads append `/{mediaId}/range|frame|clip` to. */
    mediaBaseUrl(): Promise<string>
    /** The headers that authorize a read; none locally. */
    mediaHeaders(): Promise<Record<string, string>>
    /** After a read's 401: drop the credential it was sent with, so the next `mediaHeaders` carries a fresh one. */
    refreshMediaCredential(): Promise<void>
}

/** What the reads need of their endpoint. */
export interface MediaContext {
    client(): HttpClient | null
    route(): MediaRoute
    readonly requestLogger: Logger
}

export const DEFAULT_MEDIA_DEADLINE_MS = 30 * 1000
// A 425 or an overloaded 503 without a usable Retry-After is asked again after this long.
const DEFAULT_RETRY_AFTER_MS = 1000
const OVERLOADED = 'overloaded'

/** A nanosecond timestamp as its query parameter: whole and exact, else a RangeError. */
export function nanosecondsParam(value: Nanoseconds, name: string): string {
    if (typeof value === 'bigint') {
        return value.toString()
    }
    if (!Number.isSafeInteger(value)) {
        throw new RangeError(`${name} ${value} is not a whole number of nanoseconds a number holds exactly; pass a bigint`)
    }
    return String(value)
}

/** A box rounded out to whole pixels, its left and top edges at least 0. */
export function bboxParam(box: MediaBox): string {
    const values = [box.x, box.y, box.width, box.height]
    if (!values.every(Number.isFinite)) {
        throw new RangeError(`bbox ${JSON.stringify(box)} is not four finite numbers`)
    }
    const left = Math.max(0, Math.floor(box.x))
    const top = Math.max(0, Math.floor(box.y))
    const right = Math.ceil(box.x + box.width)
    const bottom = Math.ceil(box.y + box.height)
    return `${left},${top},${Math.max(0, right - left)},${Math.max(0, bottom - top)}`
}

function headerNumber(response: Response, name: string): number | undefined {
    const value = response.headers.get(name)
    if (value === null || value.trim() === '') {
        return undefined
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

/** A Retry-After in milliseconds: the delta-seconds the media cache sends, or an HTTP date. */
function retryAfterMs(response: Response): number | undefined {
    const value = response.headers.get('Retry-After')
    if (value === null) {
        return undefined
    }
    const seconds = Number(value)
    if (Number.isFinite(seconds) && value.trim() !== '') {
        return Math.max(0, seconds * 1000)
    }
    const date = Date.parse(value)
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

type RefusalFields = { error?: string; reason?: string; message?: string }

/** A refusal's body: its JSON `error`, `reason` and `message`, or its text as the message; the read's failure if it could not be read. */
async function refusalOf(response: Response): Promise<{ fields: RefusalFields; cause?: unknown }> {
    let text: string
    try {
        text = await response.text()
    } catch (cause) {
        return { fields: {}, cause }
    }
    let fields: RefusalFields = {}
    try {
        const body = JSON.parse(text)
        if (body !== null && typeof body === 'object') {
            for (const key of ['error', 'reason', 'message'] as const) {
                if (typeof body[key] === 'string') {
                    fields[key] = body[key]
                }
            }
        }
    } catch {
        if (text) {
            fields = { message: text }
        }
    }
    return { fields }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason)
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal?.reason)
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

/** The reads of an endpoint, through its backend's route. */
export class MediaReads implements MediaReader {
    constructor(private readonly ctx: MediaContext) {}

    public async mediaRange(mediaId: string, options: { signal?: AbortSignal | undefined } = {}): Promise<MediaRange> {
        const response = await this.read(mediaId, 'range', new URLSearchParams(), {}, { deadlineMs: 0, signal: options.signal })
        const body = await response.json()
        return { startNs: Number(body?.['start_ns']), endNs: Number(body?.['end_ns']) }
    }

    public async mediaFrame(mediaId: string, timestampNs: Nanoseconds, options: MediaFrameOptions = {}): Promise<Uint8Array> {
        const query = new URLSearchParams({ timestamp: nanosecondsParam(timestampNs, 'timestampNs') })
        if (options.bbox !== undefined) {
            query.set('bbox', bboxParam(options.bbox))
        }
        if (options.maxWidth !== undefined) {
            query.set('maxWidth', String(options.maxWidth))
        }
        if (options.maxHeight !== undefined) {
            query.set('maxHeight', String(options.maxHeight))
        }
        if (options.waitMs !== undefined) {
            query.set('wait', String(options.waitMs))
        }
        const response = await this.read(mediaId, 'frame', query, { Accept: options.png ? 'image/png' : 'image/jpeg' }, options)
        return new Uint8Array(await response.arrayBuffer())
    }

    public async mediaClip(mediaId: string, startNs: Nanoseconds, endNs: Nanoseconds, options: MediaClipOptions = {}): Promise<MediaClip> {
        const query = new URLSearchParams({ start: nanosecondsParam(startNs, 'startNs'), end: nanosecondsParam(endNs, 'endNs') })
        if (options.mode !== undefined) {
            query.set('mode', options.mode)
        }
        if (options.waitMs !== undefined) {
            query.set('wait', String(options.waitMs))
        }
        const response = await this.read(mediaId, 'clip', query, { Accept: 'video/mp4' }, options, true)
        if (response.body === null) {
            throw new MediaReadError(response.status, { message: 'the clip came without a body' })
        }
        const milliComputeUnits = headerNumber(response, 'X-Milli-Compute-Units')
        return {
            stream: response.body,
            startNs: headerNumber(response, 'X-Start-Ns') ?? Number(nanosecondsParam(startNs, 'startNs')),
            endNs: headerNumber(response, 'X-End-Ns') ?? Number(nanosecondsParam(endNs, 'endNs')),
            ...(milliComputeUnits !== undefined ? { milliComputeUnits } : {}),
        }
    }

    /**
     * One read: authenticates again once after a 401, asks again after each 425's or overloaded 503's Retry-After
     * until the deadline, and throws MediaReadError for any other refusal. Not the endpoint's retry, which reconnects a session on a 404.
     */
    private async read(
        mediaId: string,
        kind: 'range' | 'frame' | 'clip',
        query: URLSearchParams,
        headers: Record<string, string>,
        options: MediaWaitOptions,
        streaming: boolean = false,
    ): Promise<Response> {
        if (typeof mediaId !== 'string' || mediaId === '') {
            throw new TypeError('mediaId must be a non-empty string')
        }
        const client = this.ctx.client()
        if (client === null) {
            throw new Error('endpoint not connected, use connect()')
        }
        const budgetMs = options.deadlineMs ?? DEFAULT_MEDIA_DEADLINE_MS
        const deadline = Date.now() + budgetMs
        const route = this.ctx.route()
        let reauthorized = false
        while (true) {
            const base = (await route.mediaBaseUrl()).replace(/\/+$/, '')
            const queryString = query.toString()
            const url = `${base}/${encodeURIComponent(mediaId)}/${kind}${queryString ? `?${queryString}` : ''}`
            this.ctx.requestLogger.debug('before GET %s', url)
            const response: Response = await client.fetch(url, {
                method: 'GET',
                headers: { ...(await route.mediaHeaders()), ...headers },
                ...(options.signal !== undefined ? { signal: options.signal } : {}),
                // @ts-ignore
                ...(streaming ? { eyepop: { responseStreaming: true } } : {}),
            })
            if (response.ok) {
                return response
            }
            if (response.status === 401 && !reauthorized) {
                reauthorized = true
                await response.body?.cancel().catch(() => undefined)
                await route.refreshMediaCredential()
                continue
            }
            const refusal = await refusalOf(response)
            // A 425 waits for the cache; a 503 overloaded waits for the pipeline API's limiter, which reads pass as sockets do.
            const retryable = response.status === 425 || (response.status === 503 && (refusal.fields.error === OVERLOADED || refusal.fields.reason === OVERLOADED))
            const retryAfter = retryable ? (retryAfterMs(response) ?? DEFAULT_RETRY_AFTER_MS) : undefined
            if (retryAfter !== undefined && budgetMs > 0 && Date.now() + retryAfter <= deadline) {
                this.ctx.requestLogger.debug('%s of %s answered %d, asking again in %d ms', kind, mediaId, response.status, retryAfter)
                await sleep(retryAfter, options.signal)
                continue
            }
            throw new MediaReadError(response.status, refusal.fields, retryAfter, refusal.cause)
        }
    }
}

/**
 * The frame a prediction was made on, cropped to one of its objects when given: the read a job's `mediaFrame`
 * makes. The timestamp is the prediction's `timestamp`; the box is the object's `x`, `y`, `width` and `height`,
 * which are in the prediction's source pixels (`source_width` by `source_height`), the recorded frame's pixels,
 * rounded out to whole pixels and clipped to the source.
 */
export async function predictionFrame(reader: MediaReader, mediaId: string | undefined, prediction: Prediction, object?: PredictedObject, options: MediaFrameOptions = {}): Promise<Uint8Array> {
    if (mediaId === undefined) {
        throw new PredictionFrameError('no_media_id', 'this job has no mediaId: it records only with mediaCacheSeconds, and only once its source started (its recording event or start)')
    }
    const timestamp = prediction.timestamp
    if (timestamp === undefined || timestamp === null) {
        throw new PredictionFrameError('no_timestamp', 'the prediction has no timestamp to read a frame at')
    }
    let bbox = options.bbox
    if (object !== undefined) {
        bbox = clippedBox(object, prediction.source_width, prediction.source_height)
    }
    return await reader.mediaFrame(mediaId, timestamp, { ...options, bbox })
}

function clippedBox(object: PredictedObject, sourceWidth: number | undefined, sourceHeight: number | undefined): MediaBox {
    let left = object.x
    let top = object.y
    let right = object.x + object.width
    let bottom = object.y + object.height
    if (sourceWidth !== undefined && sourceWidth > 0) {
        right = Math.min(right, sourceWidth)
    }
    if (sourceHeight !== undefined && sourceHeight > 0) {
        bottom = Math.min(bottom, sourceHeight)
    }
    left = Math.max(0, left)
    top = Math.max(0, top)
    return { x: left, y: top, width: right - left, height: bottom - top }
}
