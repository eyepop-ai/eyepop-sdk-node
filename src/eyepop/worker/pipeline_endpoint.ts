/**
 * A WorkerEndpoint backed by the pipeline API's socket (SDK-27, the Node side of SDK-24).
 *
 * The socket protocol is eyepop-instance spec 019, `contracts/socket.md`: one socket runs its
 * own pipeline and takes commands, `setPop` and `setSource` among them, and streams every
 * source's predictions back under the source's id.
 */
import { LocalAuth, resolveAuth } from '../options'
import { Prediction } from '../types'
import { resolvePath } from '../shims/local_file'
import { UpgradeError, openAuthorizedWebSocket } from '../shims/websockets'
import { WorkerEndpoint } from './worker_endpoint'
import { WorkerOptions } from './worker_options'
import { WebrtcBase } from './webrtc_base'
import {
    AssetUuidSource,
    ComponentParams,
    FileSource,
    MediaStreamSource,
    PathSource,
    Pop,
    ProcessParams,
    ProcessRequest,
    ResultStream,
    Source,
    StreamSource,
    UrlSource,
    WorkerSession,
    validatePop,
} from './worker_types'
import { validateCamera } from '../camera'

export const PIPELINE_PATH = '/api/v1/pipeline'
export const SUBPROTOCOL = 'eyepop.v1'
/** A socket may have this many open sources; one more is answered `queue_full`. */
export const MAX_OPEN_SOURCES = 256
/** Uploads up to this size go as one combined message, larger ones in chunks. */
export const COMBINED_UPLOAD_MAX_BYTES = 8 * 1024 * 1024

const CHUNK = 0x01
const COMBINED = 0x02
const CHUNK_BYTES = 64 * 1024
const HEARTBEAT_MS = 20 * 1000
const MAX_RETRY_MS = 30 * 1000
// The closes after which the endpoint opens a new socket at once; after any other close it opens
// one when the next job or changePop needs it.
const RECONNECT_AT_ONCE = new Set(['1008 credential_expired', '1011 overloaded', '1001 shutting_down'])

/** A job in flight when the pipeline API's socket closed; the job is not sent again. */
export class PipelineSocketClosedError extends Error {
    readonly code: number | undefined
    readonly reason: string

    constructor(code: number | undefined, reason: string) {
        super(`the pipeline API closed the socket: ${code ?? ''} ${reason}`.trim())
        this.name = 'PipelineSocketClosedError'
        this.code = code
        this.reason = reason
    }
}

/** The pipeline API answered a command with an error, for instance `queue_full`. */
export class PipelineCommandError extends Error {
    readonly error: string
    readonly detail: string

    constructor(error: string, detail: string = '') {
        super(`the pipeline API refused the command: ${error} ${detail}`.trim())
        this.name = 'PipelineCommandError'
        this.error = error
        this.detail = detail
    }
}

/** A source ended with reason `error` or `preempted` rather than at its end of stream. */
export class PipelineSourceError extends Error {
    readonly sourceId: string
    readonly reason: string
    readonly detail: string

    constructor(sourceId: string, reason: string, detail: string = '') {
        super(`Error in source ${sourceId}: ${reason} ${detail}`.trim())
        this.name = 'PipelineSourceError'
        this.sourceId = sourceId
        this.reason = reason
        this.detail = detail
    }
}

type Message = Record<string, any>
type UploadBody = ReadableStream<Uint8Array> | Blob | BufferSource

const CANCELLED = Symbol('cancelled')
type InboxItem = Message | Error | typeof CANCELLED

/** An unbounded queue one consumer awaits. */
class Inbox<T> {
    private readonly _items: T[] = []
    private _waiter: ((item: T) => void) | null = null

    push(item: T): void {
        const waiter = this._waiter
        if (waiter) {
            this._waiter = null
            waiter(item)
        } else {
            this._items.push(item)
        }
    }

    next(): Promise<T> {
        const item = this._items.shift()
        if (item !== undefined) {
            return Promise.resolve(item)
        }
        return new Promise(resolve => (this._waiter = resolve))
    }
}

class UploadEnded extends Error {}

/** A chunked upload's credit, granted by the server's `send` and `credit`. */
class Credit {
    private _credit = 0
    private _ended = false
    private _waiter: (() => void) | null = null

    grant(n: number): void {
        this._credit += n
        this.wake()
    }

    end(): void {
        this._ended = true
        this.wake()
    }

    async take(most: number): Promise<number> {
        while (this._credit <= 0 && !this._ended) {
            await new Promise<void>(resolve => (this._waiter = resolve))
        }
        if (this._ended) {
            throw new UploadEnded()
        }
        const n = Math.min(most, this._credit)
        this._credit -= n
        return n
    }

    private wake(): void {
        const waiter = this._waiter
        this._waiter = null
        waiter?.()
    }
}

/** A job's source on one socket: the messages for its id, and its chunked uploads by member. */
class OpenSource {
    readonly inbox = new Inbox<InboxItem>()
    readonly uploads = new Map<number | null, Credit>()

    constructor(readonly id: string) {}

    close(error: Error): void {
        this.uploads.forEach(upload => upload.end())
        this.inbox.push(error)
    }
}

/** One upgraded socket: its open sources and commands by id. */
class PipelineSocket {
    readonly sources = new Map<string, OpenSource>()
    readonly commands = new Map<string, { resolve: (m: Message) => void; reject: (e: Error) => void }>()
    readonly closed: Promise<void>
    private _closed = false
    private _markClosed!: () => void

    constructor(readonly ws: WebSocket) {
        this.closed = new Promise(resolve => (this._markClosed = resolve))
    }

    get open(): boolean {
        return !this._closed && this.ws.readyState === 1
    }

    markClosed(): void {
        this._closed = true
        this._markClosed()
    }

    sendJson(message: Message): void {
        this.ws.send(JSON.stringify(message))
    }

    sendBytes(data: Uint8Array): void {
        this.ws.send(data)
    }
}

/** One upload member's bytes: a fresh body and its content type, and its size when known. */
interface Media {
    readonly open: () => Promise<UploadBody>
    readonly contentType: string
    readonly size: number | undefined
}

/** A job: one source on the endpoint's socket, its predictions read as an async iterable. */
export class PipelineJob implements ResultStream {
    private readonly _results = new Inbox<Prediction | Error | null>()
    private _consumed = false
    private _cancelled = false
    openSource: OpenSource | null = null

    constructor(
        readonly source: Message,
        readonly media: Media[],
        readonly live: boolean,
        readonly params: ProcessParams,
        readonly mediaStream: MediaStream | undefined = undefined,
    ) {}

    get cancelled(): boolean {
        return this._cancelled
    }

    command(id: string): Message {
        const command: Message = { type: 'setSource', id, ...this.source }
        if (this.params.componentParams !== undefined) {
            command['params'] = this.params.componentParams
        }
        if (this.params.roi !== undefined) {
            command['roi'] = this.params.roi
        }
        if (this.params.camera !== undefined) {
            command['camera'] = this.params.camera
        }
        if (this.params.fps !== undefined) {
            command['fps'] = this.params.fps
        }
        return command
    }

    predicted(prediction: Prediction): void {
        if (!this._cancelled) {
            this._results.push(prediction)
        }
    }

    finish(error: Error | null = null): void {
        if (error !== null) {
            this._results.push(error)
        }
        this._results.push(null)
    }

    cancel(): void {
        if (this._cancelled) {
            return
        }
        this._cancelled = true
        this._results.push(null)
        this.openSource?.inbox.push(CANCELLED)
    }

    async *[Symbol.asyncIterator](): AsyncIterator<Prediction> {
        if (this._consumed) {
            throw new Error('Cannot iterate over a consumed stream')
        }
        this._consumed = true
        while (true) {
            const item = await this._results.next()
            if (item === null) {
                return
            }
            if (item instanceof Error) {
                throw item
            }
            yield item
        }
    }
}

export class PipelineEndpoint extends WorkerEndpoint {
    private _pipelineApiUrl: string | null = null
    private _socket: PipelineSocket | null = null
    private _connecting: Promise<PipelineSocket> | null = null
    // Every job's setSource and every changePop goes out through this chain, in the order submitted.
    private _sendChain: Promise<unknown> = Promise.resolve()
    private _disconnecting = false
    private _nextId = 0
    private _currentPop: Pop | null
    private readonly _warned = new Set<string>()
    private _heartbeat: ReturnType<typeof setInterval> | null = null

    constructor(options: WorkerOptions) {
        if ((options.jobQueueLength ?? MAX_OPEN_SOURCES) > MAX_OPEN_SOURCES) {
            throw new Error(`jobQueueLength ${options.jobQueueLength} exceeds ${MAX_OPEN_SOURCES}, the open sources a pipeline API socket takes`)
        }
        super(options)
        this._currentPop = options.pop ?? null
    }

    // Connection

    protected override async reconnect(): Promise<WorkerEndpoint> {
        this._disconnecting = false
        await this.inOrder(() => this.ensureSocket())
        this.updateState()
        return this
    }

    public override async disconnect(wait: boolean = true): Promise<void> {
        await super.disconnect(wait)
        this._disconnecting = true
        if (this._heartbeat !== null) {
            clearInterval(this._heartbeat)
            this._heartbeat = null
        }
        const socket = this._socket
        this._socket = null
        if (socket !== null) {
            socket.ws.close(1000)
            await socket.closed
        }
    }

    private inOrder<T>(work: () => Promise<T>): Promise<T> {
        const result = this._sendChain.then(work)
        this._sendChain = result.catch(() => undefined)
        return result
    }

    /** The open socket, or a new one with the last pop set on it. */
    private async ensureSocket(): Promise<PipelineSocket> {
        if (this._socket !== null && this._socket.open) {
            return this._socket
        }
        if (this._connecting === null) {
            this._connecting = this.openSocket().finally(() => (this._connecting = null))
        }
        return await this._connecting
    }

    private async openSocket(): Promise<PipelineSocket> {
        if (this._client === null) {
            throw new PipelineSocketClosedError(undefined, 'the endpoint is not connected')
        }
        const ws = await this.upgrade(await this.socketUrl())
        const socket = new PipelineSocket(ws)
        ws.onmessage = (event: MessageEvent) => {
            if (typeof event.data === 'string') {
                try {
                    this.dispatch(socket, JSON.parse(event.data))
                } catch (error) {
                    this._logger.warn('unreadable message from the pipeline API: %s', error)
                }
            }
        }
        ws.onerror = () => {}
        ws.onclose = (event: CloseEvent) => this.closed(socket, event.code, event.reason)
        this._socket = socket
        this.startHeartbeat(ws)
        if (this._currentPop !== null) {
            try {
                await this.setPopOn(socket, this._currentPop)
            } catch (error) {
                // A socket whose pipeline does not run the pop runs no job.
                this._socket = null
                ws.close(1000)
                throw error
            }
        }
        return socket
    }

    private startHeartbeat(ws: WebSocket): void {
        if (this._heartbeat !== null) {
            clearInterval(this._heartbeat)
        }
        // A ping keeps the connection alive, nothing else; only Node's ws can send one.
        const ping = (ws as any).ping
        if (typeof ping === 'function') {
            this._heartbeat = setInterval(() => {
                if (ws.readyState === 1) {
                    ping.call(ws)
                }
            }, HEARTBEAT_MS)
            ;(this._heartbeat as any).unref?.()
        }
    }

    private async socketUrl(): Promise<string> {
        if (this._pipelineApiUrl === null) {
            const options = this._options as WorkerOptions
            const base = options.isLocalMode ? this.eyepopUrl() : new URL(await this.configuredPipelineApiUrl(), this.eyepopUrl() + '/').toString()
            this._pipelineApiUrl = checkedUrl(base)
        }
        return 'ws' + this._pipelineApiUrl.slice('http'.length) + PIPELINE_PATH
    }

    private async configuredPipelineApiUrl(): Promise<string> {
        const client = this._client
        if (client === null) {
            throw new Error('endpoint not connected')
        }
        let configUrl = `${this.eyepopUrl()}/v1/configs`
        const accountId = (this._options as WorkerOptions).accountId
        if (accountId) {
            configUrl += `?account_uuid=${encodeURIComponent(accountId)}`
        }
        const response = await this.fetchWithRetry(async () => client.fetch(configUrl, { headers: { Authorization: await this.authorizationHeader() } }))
        if (!response.ok) {
            throw new Error(`Unexpected status ${response.status} for GET ${configUrl}: ${await response.text()}`)
        }
        const config = await response.json()
        const url = config?.['pipeline_api_url']
        if (!url) {
            throw new Error(`${configUrl} has no pipeline_api_url: this compute API serves no pipeline API`)
        }
        return url
    }

    private async token(): Promise<string | undefined> {
        if ((resolveAuth(this._options) as LocalAuth | undefined)?.isLocal !== undefined) {
            return undefined
        }
        return (await this.authorizationHeader()).replace(/^Bearer /, '')
    }

    /** Open the socket, waiting through 503 with Retry-After and exchanging the API key again after a 401. */
    private async upgrade(url: string): Promise<WebSocket> {
        const deadline = Date.now() + MAX_RETRY_MS
        let rejected = false
        while (true) {
            try {
                this._requestLogger.debug('before upgrade %s', url)
                return await openAuthorizedWebSocket(url, SUBPROTOCOL, await this.token())
            } catch (error) {
                if (!(error instanceof UpgradeError)) {
                    throw error
                }
                if (error.status === 401 && !rejected) {
                    this._requestLogger.debug('the pipeline API answered 401, authenticating again')
                    rejected = true
                    this.statusHandler401(401)
                    continue
                }
                const wait = error.status === 503 && error.retryAfter !== undefined ? Math.max(error.retryAfter, 1) * 1000 : undefined
                if (wait === undefined || Date.now() + wait > deadline) {
                    throw error
                }
                this._requestLogger.info('the pipeline API answered 503, retrying in %d ms', wait)
                await new Promise(resolve => setTimeout(resolve, wait))
            }
        }
    }

    private closed(socket: PipelineSocket, code: number | undefined, reason: string): void {
        socket.markClosed()
        if (this._socket === socket) {
            this._socket = null
        }
        const error = new PipelineSocketClosedError(code, reason)
        socket.sources.forEach(source => source.close(error))
        socket.commands.forEach(command => command.reject(error))
        socket.commands.clear()
        if (this._disconnecting) {
            return
        }
        this._requestLogger.debug('the pipeline API closed the socket: %s %s', code, reason)
        if (RECONNECT_AT_ONCE.has(`${code} ${reason}`)) {
            if (reason === 'credential_expired') {
                this.statusHandler401(401)
            }
            this.inOrder(() => this.ensureSocket()).catch(error => {
                // The next job or changePop tries again and reports what fails.
                this._requestLogger.info('could not reopen the pipeline API socket: %s', error)
            })
        }
    }

    private dispatch(socket: PipelineSocket, message: Message): void {
        const type = message['type']
        const id = message['id']
        const source = typeof id === 'string' ? socket.sources.get(id) : undefined
        if (type === 'send' || type === 'credit') {
            const upload = source?.uploads.get(message['member'] ?? null)
            upload?.grant(Number(type === 'send' ? message['credit'] : message['bytes']))
            return
        }
        const command = typeof id === 'string' ? socket.commands.get(id) : undefined
        if (command !== undefined) {
            socket.commands.delete(id)
            if (type === 'error') {
                command.reject(new PipelineCommandError(message['error'] ?? '', message['message'] ?? ''))
            } else {
                command.resolve(message)
            }
            return
        }
        if (source !== undefined) {
            if (type === 'end') {
                source.uploads.forEach(upload => upload.end())
            }
            source.inbox.push(message)
        } else if (type === 'error') {
            this._logger.warn('the pipeline API refused a message: %s %s', message['error'], message['message'])
        }
    }

    private newId(prefix: string): string {
        this._nextId += 1
        return `${prefix}-${this._nextId}`
    }

    /** Send a command that is answered by `result` or `error` under its id. */
    private command(socket: PipelineSocket, message: Message): Promise<Message> {
        const id = this.newId(message['type'])
        return new Promise((resolve, reject) => {
            socket.commands.set(id, { resolve, reject })
            socket.sendJson({ ...message, id })
        })
    }

    // Pop

    public override pop(): Pop | null {
        return this._currentPop
    }

    /** Set the pop on the socket's pipeline; a pop it refuses rejects, and the last pop it took stays. */
    public override async changePop(pop: Pop): Promise<void> {
        validatePop(pop)
        if (this._client === null) {
            this._currentPop = pop
            return
        }
        await this.inOrder(async () => {
            if (this._socket !== null && this._socket.open) {
                await this.setPopOn(this._socket, pop)
                this._currentPop = pop
                return
            }
            const previous = this._currentPop
            this._currentPop = pop
            try {
                await this.ensureSocket()
            } catch (error) {
                this._currentPop = previous
                throw error
            }
        })
    }

    private async setPopOn(socket: PipelineSocket, pop: Pop): Promise<void> {
        await this.command(socket, { type: 'setPop', pop })
    }

    // Jobs

    public override async process(source: Source, params?: ComponentParams[]): Promise<ResultStream>
    public override async process({ source, componentParams, motionDetect, roi }: ProcessRequest): Promise<ResultStream>
    public override async process(param1: any, param2?: any): Promise<ResultStream> {
        const request: ProcessRequest = (param1 as ProcessRequest).source !== undefined ? param1 : { source: param1, componentParams: param2 }
        this.validate(request)
        return await this.submit(await this.jobOf(request.source, request))
    }

    public override async uploadGroup(paths: string[], params: ProcessParams = {}): Promise<ResultStream> {
        if (paths.length === 0) {
            throw new Error('upload group requires at least one path')
        }
        this.validate(params)
        const media = await Promise.all(paths.map(path => this.pathMedia({ path })))
        return await this.submit(new PipelineJob(uploadGroup(media), media, false, params))
    }

    public override async uploadStreamGroup(streams: Array<ReadableStream<Uint8Array> | Blob | BufferSource>, mimeTypes?: string[], params: ProcessParams = {}): Promise<ResultStream> {
        if (streams.length === 0) {
            throw new Error('upload stream group requires at least one stream')
        }
        if (mimeTypes !== undefined && mimeTypes.length !== streams.length) {
            throw new Error('mimeTypes must have the same length as streams')
        }
        this.validate(params)
        const media = streams.map((stream, i) => bodyMedia(stream, mimeTypes?.[i] ?? 'application/octet-stream', undefined))
        return await this.submit(new PipelineJob(uploadGroup(media), media, false, params))
    }

    public override async loadFromGroup(urls: string[], params: ProcessParams = {}): Promise<ResultStream> {
        if (urls.length === 0) {
            throw new Error('load from group requires at least one url')
        }
        this.validate(params)
        return await this.submit(new PipelineJob({ group: urls.map(url => ({ url })) }, [], false, params))
    }

    private validate(params: ProcessParams & { source?: Source }): void {
        if (params.camera !== undefined) {
            validateCamera(params.camera)
        }
        const videoMode = (params.source as FileSource | StreamSource | PathSource | undefined)?.videoMode
        this.notSent({ motionDetect: params.motionDetect, videoMode, rtspForceNonCompliantUrl: params.rtspForceNonCompliantUrl })
    }

    private notSent(options: Record<string, unknown>): void {
        for (const [name, value] of Object.entries(options)) {
            if (value === undefined || this._warned.has(name)) {
                continue
            }
            this._warned.add(name)
            const ticket = name === 'rtspForceNonCompliantUrl' ? '' : ' (AWSU-317)'
            this._logger.warn(`${name} is not sent to the pipeline API and has no effect in pipeline mode${ticket}`)
        }
    }

    private async jobOf(source: Source, params: ProcessParams): Promise<PipelineJob> {
        if ((source as FileSource).file !== undefined) {
            const file = (source as FileSource).file
            const media = bodyMedia(file, file.type || 'application/octet-stream', file.size)
            return new PipelineJob({ upload: { contentType: media.contentType } }, [media], false, params)
        } else if ((source as StreamSource).stream !== undefined) {
            const stream = source as StreamSource
            const media = bodyMedia(stream.stream, stream.mimeType, stream.size ?? knownSize(stream.stream))
            return new PipelineJob({ upload: { contentType: media.contentType } }, [media], false, params)
        } else if ((source as PathSource).path !== undefined) {
            const media = await this.pathMedia(source as PathSource)
            return new PipelineJob({ upload: { contentType: media.contentType } }, [media], false, params)
        } else if ((source as UrlSource).url !== undefined) {
            const url = (source as UrlSource).url
            if (url.startsWith('file://')) {
                return await this.jobOf({ path: url.substring('file://'.length) }, params)
            }
            return new PipelineJob({ url }, [], /^(rtsp|rtmp):\/\//.test(url), params)
        } else if ((source as AssetUuidSource).assetUuid !== undefined) {
            return new PipelineJob({ assetUuid: (source as AssetUuidSource).assetUuid }, [], false, params)
        } else if ((source as MediaStreamSource).mediaStream !== undefined) {
            const ingressId = this.newId('whip')
            return new PipelineJob({ whip: { ingressId } }, [], true, params, (source as MediaStreamSource).mediaStream)
        }
        throw new Error('unknown source type')
    }

    private async pathMedia(source: PathSource): Promise<Media> {
        const resolve = async () => (this._options.platformSupport?.resolvePath ? await this._options.platformSupport.resolvePath(source, this._logger) : await resolvePath(source, this._logger))
        const first = await resolve()
        let firstPending = true
        return {
            contentType: first.mimeType,
            size: first.size,
            open: async () => {
                if (firstPending) {
                    firstPending = false
                    return first.stream
                }
                return (await resolve()).stream
            },
        }
    }

    private async submit(job: PipelineJob): Promise<ResultStream> {
        if (this._client === null) {
            throw new Error('endpoint not connected, use connect()')
        }
        await this._limit.acquire()
        this.updateState()
        this.run(job)
            .then(
                () => job.finish(),
                error => job.finish(error instanceof Error ? error : new Error(String(error))),
            )
            .finally(() => {
                this._limit.release()
                this.updateState()
            })
        return job
    }

    /** Run the job's source to its end; a live source refused overloaded goes once more on a new socket. */
    private async run(job: PipelineJob): Promise<void> {
        let retried = false
        while (true) {
            const { socket, source } = await this.inOrder(() => this.setSource(job))
            const uploading = source.uploads.size > 0 ? this.upload(socket, source, job) : Promise.resolve()
            let whip: SocketWhip | null = null
            let overloaded: boolean
            try {
                overloaded = await this.follow(job, source, () => {
                    if (job.mediaStream !== undefined) {
                        whip = new SocketWhip(job.mediaStream, job.source['whip']['ingressId'], message => this.command(socket, message), this._requestLogger)
                        whip.start().catch(error => source.inbox.push(error instanceof Error ? error : new Error(String(error))))
                    }
                })
            } finally {
                job.openSource = null
                socket.sources.delete(source.id)
                source.uploads.forEach(upload => upload.end())
                await uploading
                await (whip as SocketWhip | null)?.close()
            }
            if (!overloaded) {
                return
            }
            if (retried || !job.live) {
                throw new PipelineCommandError('overloaded', 'the pipeline API has no capacity for another live source')
            }
            retried = true
            await socket.closed
        }
    }

    /** Send the job's setSource; the caller runs it in submission order. */
    private async setSource(job: PipelineJob): Promise<{ socket: PipelineSocket; source: OpenSource }> {
        const combined = await combinedMedia(job)
        const socket = await this.ensureSocket()
        const source = new OpenSource(this.newId('source'))
        if (combined === null) {
            uploadKeys(job).forEach(key => source.uploads.set(key, new Credit()))
        }
        socket.sources.set(source.id, source)
        job.openSource = source
        const command = job.command(source.id)
        if (combined === null) {
            socket.sendJson(command)
        } else {
            socket.sendBytes(combinedMessage(command, combined))
        }
        return { socket, source }
    }

    /** Hand the source's predictions to the job until it ends; true when the pipeline API was overloaded. */
    private async follow(job: PipelineJob, source: OpenSource, onResult: () => void): Promise<boolean> {
        while (true) {
            if (job.cancelled) {
                return false
            }
            const message = await source.inbox.next()
            if (message === CANCELLED) {
                return false
            }
            if (message instanceof Error) {
                throw message
            }
            switch (message['type']) {
                case 'result':
                    onResult()
                    break
                case 'prediction':
                    job.predicted(message['prediction'] as Prediction)
                    break
                case 'end':
                    if (message['reason'] === 'eos') {
                        return false
                    }
                    throw new PipelineSourceError(source.id, message['reason'] ?? '', message['message'] ?? '')
                case 'error':
                    if (message['error'] === 'overloaded') {
                        return true
                    }
                    throw new PipelineCommandError(message['error'] ?? '', message['message'] ?? '')
                case 'dropped':
                    this._requestLogger.debug('the pipeline API dropped %s predictions of a live source', message['count'])
                    break
            }
        }
    }

    /** Send each upload member's bytes in chunks within its credit, then its uploaded. */
    private async upload(socket: PipelineSocket, source: OpenSource, job: PipelineJob): Promise<void> {
        const keys = uploadKeys(job)
        try {
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i] as number | null
                const credit = source.uploads.get(key) as Credit
                for await (let piece of pieces(await (job.media[i] as Media).open())) {
                    while (piece.length > 0) {
                        const n = await credit.take(Math.min(piece.length, CHUNK_BYTES))
                        const chunk = new Uint8Array(n + 1)
                        chunk[0] = CHUNK
                        chunk.set(piece.subarray(0, n), 1)
                        socket.sendBytes(chunk)
                        piece = piece.subarray(n)
                    }
                }
                socket.sendJson(key === null ? { type: 'uploaded', id: source.id } : { type: 'uploaded', id: source.id, member: key })
            }
        } catch (error) {
            if (!(error instanceof UploadEnded)) {
                // The source ended or the socket closed in any other case; the job reports how.
                if (socket.open) {
                    source.inbox.push(error instanceof Error ? error : new Error(String(error)))
                }
            }
        }
    }

    // Session-era methods

    public override async session(): Promise<WorkerSession> {
        const token = await this.token()
        return {
            eyepopUrl: this.eyepopUrl(),
            accessToken: token ?? '',
            validUntil: Number.MAX_VALUE,
            popId: 'transient',
            accountId: (this._options as WorkerOptions).accountId,
            baseUrl: this._pipelineApiUrl ?? undefined,
            pipelineId: undefined,
            authenticationHeaders: () => (token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        }
    }
}

/**
 * WHIP signalled over the socket (spec 019): ICE servers, the offer and each local candidate go
 * as `whipIceServers`, `whipOffer` and `whipIce` for the source's ingress; the media goes over WebRTC.
 */
class SocketWhip {
    private _pc: RTCPeerConnection | null = null
    private _answered = false
    private _queued: RTCIceCandidate[] = []
    private _offerData: ReturnType<typeof WebrtcBase.parseOffer> | null = null

    constructor(
        private readonly _stream: MediaStream,
        private readonly _ingressId: string,
        private readonly _command: (message: Message) => Promise<Message>,
        private readonly _logger: { debug: (...args: any[]) => void },
    ) {}

    async start(): Promise<void> {
        const servers = await this._command({ type: 'whipIceServers', ingressId: this._ingressId })
        const pc = new RTCPeerConnection({ iceServers: WebrtcBase.linkToIceServers(((servers['iceServers'] as string[] | undefined) ?? []).join(', ') || null) })
        this._pc = pc
        pc.onicecandidate = evt => {
            if (evt.candidate !== null) {
                this.candidate(evt.candidate).catch(error => this._logger.debug('whipIce failed: %s', error))
            }
        }
        this._stream.getTracks().forEach(track => pc.addTrack(track, this._stream))
        const offer = await pc.createOffer()
        if (!offer.sdp) {
            throw new Error('the local offer has no sdp')
        }
        this._offerData = WebrtcBase.parseOffer(offer.sdp)
        await pc.setLocalDescription(offer)
        const answer = await this._command({ type: 'whipOffer', ingressId: this._ingressId, sdp: offer.sdp })
        await pc.setRemoteDescription({ type: 'answer', sdp: answer['sdp'] })
        this._answered = true
        const queued = this._queued
        this._queued = []
        if (queued.length > 0) {
            await this.sendCandidates(queued)
        }
    }

    private async candidate(candidate: RTCIceCandidate): Promise<void> {
        if (!this._answered) {
            this._queued.push(candidate)
            return
        }
        await this.sendCandidates([candidate])
    }

    private async sendCandidates(candidates: RTCIceCandidate[]): Promise<void> {
        if (this._offerData === null) {
            return
        }
        await this._command({ type: 'whipIce', ingressId: this._ingressId, fragment: WebrtcBase.generateSdpFragment(this._offerData, candidates) })
    }

    async close(): Promise<void> {
        this._stream.getTracks().forEach(track => track.stop())
        const pc = this._pc
        this._pc = null
        pc?.close()
    }
}

function checkedUrl(url: string): string {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`the pipeline API url ${url} must be an http or https url`)
    }
    if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
        throw new Error(`the pipeline API url ${url} must use https unless its host is a loopback address`)
    }
    return url.replace(/\/+$/, '')
}

function isLoopback(host: string): boolean {
    return host === 'localhost' || host === '[::1]' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

function knownSize(body: UploadBody): number | undefined {
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return body.size
    }
    if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
        return body.byteLength
    }
    return undefined
}

function bodyMedia(body: UploadBody, contentType: string, size: number | undefined): Media {
    return { open: async () => body, contentType, size: size ?? knownSize(body) }
}

function uploadGroup(media: Media[]): Message {
    return { group: media.map(m => ({ upload: { contentType: m.contentType } })) }
}

/** The member index of each upload member, or null for a source that is one upload. */
function uploadKeys(job: PipelineJob): Array<number | null> {
    if (job.source['upload'] !== undefined) {
        return [null]
    }
    const group = (job.source['group'] as Message[] | undefined) ?? []
    return group.flatMap((member, i) => (member['upload'] !== undefined ? [i] : []))
}

/** The upload members' bytes when the job goes as one combined message, else null for chunked. */
async function combinedMedia(job: PipelineJob): Promise<Uint8Array[] | null> {
    if (job.media.length === 0 || job.live || job.media.some(m => m.size === undefined)) {
        return null
    }
    if (job.media.reduce((total, m) => total + (m.size ?? 0), 0) > COMBINED_UPLOAD_MAX_BYTES) {
        return null
    }
    const bytes: Uint8Array[] = []
    for (const media of job.media) {
        bytes.push(await readAll(await media.open()))
    }
    return bytes
}

async function readAll(body: UploadBody): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    for await (const piece of pieces(body)) {
        parts.push(piece)
    }
    return concat(parts)
}

function concat(parts: Uint8Array[]): Uint8Array {
    const all = new Uint8Array(parts.reduce((total, p) => total + p.length, 0))
    let offset = 0
    for (const part of parts) {
        all.set(part, offset)
        offset += part.length
    }
    return all
}

function combinedMessage(command: Message, media: Uint8Array[]): Uint8Array {
    if (command['group'] !== undefined) {
        let i = 0
        command = {
            ...command,
            group: (command['group'] as Message[]).map(member => (member['upload'] !== undefined ? { upload: { ...member['upload'], bytes: (media[i++] as Uint8Array).length } } : member)),
        }
    }
    const header = new TextEncoder().encode(JSON.stringify(command))
    const prefix = new Uint8Array(5)
    prefix[0] = COMBINED
    new DataView(prefix.buffer).setUint32(1, header.length, false)
    return concat([prefix, header, ...media])
}

async function* pieces(body: UploadBody): AsyncGenerator<Uint8Array> {
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        yield* pieces(body.stream() as ReadableStream<Uint8Array>)
    } else if (body instanceof ArrayBuffer) {
        yield new Uint8Array(body)
    } else if (ArrayBuffer.isView(body)) {
        yield new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    } else {
        const reader = (body as ReadableStream<Uint8Array>).getReader()
        try {
            while (true) {
                const { value, done } = await reader.read()
                if (done) {
                    return
                }
                if (value !== undefined && value.length > 0) {
                    yield value
                }
            }
        } finally {
            reader.releaseLock()
        }
    }
}
