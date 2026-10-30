/**
 * Runs a WorkerEndpoint's jobs on the pipeline API's sockets (SDK-27, the Node side of SDK-24).
 *
 * The socket protocol is eyepop-instance spec 019, `contracts/socket.md`: one socket runs its
 * own pipeline and takes commands, `setPop` and `setSource` among them, and streams every
 * source's predictions back under the source's id.
 */
import { LocalAuth, resolveAuth } from '../options'
import { Prediction } from '../types'
import { resolvePath } from '../shims/local_file'
import { UpgradeError, openAuthorizedWebSocket } from '../shims/websockets'
import { WorkerBackend, WorkerContext, WorkerWork } from './worker_backend'
import { WebrtcBase } from './webrtc_base'
import { AssetUuidSource, FileSource, MediaStreamSource, PathSource, Pop, ProcessParams, ResultStream, Source, StreamSource, UrlSource, WorkerSession } from './worker_types'

export const PIPELINE_PATH = '/api/v1/pipeline'
export const SUBPROTOCOL = 'eyepop.v1'
/** A socket may have this many open sources; one more is answered `queue_full`. */
export const MAX_OPEN_SOURCES = 256
/** The most sockets an endpoint opens unless `pipelineSockets` says otherwise. */
export const PIPELINE_SOCKETS = 4
// After the pipeline API refused another socket, the endpoint tries again only this much later.
const EXTRA_SOCKET_RETRY_MS = 10 * 1000
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
// The longest wait before such a reconnect, when one close follows another with no source played between.
const MAX_RECONNECT_DELAY_MS = 30 * 1000

/** Why pipeline mode refused its configuration. */
export type PipelineConfigurationProblem = 'session_options' | 'job_queue_length' | 'no_pipeline_api_url' | 'insecure_url'

/** Pipeline mode cannot run as configured; `options` names the refused options for `session_options`. */
export class PipelineConfigurationError extends Error {
    readonly problem: PipelineConfigurationProblem
    readonly options: string[]

    constructor(problem: PipelineConfigurationProblem, message: string, options: string[] = []) {
        super(message)
        this.name = 'PipelineConfigurationError'
        this.problem = problem
        this.options = options
    }
}

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
    // The socket's ended count when the setSource went out.
    endedBefore = 0

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
    // The ids of sources sent on this socket that have neither ended nor been refused, as the
    // pipeline API counts them, cancelled ones included.
    readonly held = new Set<string>()
    // The held sources that are live. A live source never ends, so nothing queued behind it plays.
    readonly lives = new Set<string>()
    // The ends on this socket so far.
    ended = 0
    // How many sources were open when the socket last refused queue_full: while as many are open,
    // the next send waits. Null once none is open.
    cap: number | null = null
    private _roomWaiters: (() => void)[] = []
    heartbeat: ReturnType<typeof setInterval> | null = null

    constructor(readonly ws: WebSocket) {
        this.closed = new Promise(resolve => (this._markClosed = resolve))
    }

    /** A source ended or the socket closed: wake the send waiting for room. */
    freed(): void {
        this.ended += 1
        this.wake()
    }

    /** A held source ended or was refused: wake the send waiting for room. */
    wake(): void {
        if (this.held.size === 0) {
            this.cap = null
        }
        const waiters = this._roomWaiters
        this._roomWaiters = []
        waiters.forEach(wake => wake())
    }

    get hasRoom(): boolean {
        return this.cap === null || this.held.size < this.cap
    }

    /**
     * Wait, while the socket is full, until a source ends, it closes or the job is cancelled. The
     * caller sends in order, so one send waits here and each end lets one go, instead of every
     * refused source sending its media again at once.
     */
    async room(job: PipelineJob): Promise<void> {
        while (!this.hasRoom && this.open && !job.cancelled) {
            await Promise.race([new Promise<void>(resolve => this._roomWaiters.push(resolve)), job.whenCancelled])
        }
    }

    get open(): boolean {
        return !this._closed && this.ws.readyState === 1
    }

    markClosed(): void {
        if (this.heartbeat !== null) {
            clearInterval(this.heartbeat)
            this.heartbeat = null
        }
        this._closed = true
        this._markClosed()
        this.freed()
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
    // A stream of the caller's, which can be read only once.
    readonly once?: boolean
}

/** A job: one source on the endpoint's socket, its predictions read as an async iterable. */
export class PipelineJob implements ResultStream {
    private readonly _results = new Inbox<Prediction | Error | null>()
    private _consumed = false
    private _cancelled = false
    private _markCancelled!: () => void
    // Settles when the job is cancelled, so that a send waiting for room ends at once.
    readonly whenCancelled = new Promise<void>(resolve => (this._markCancelled = resolve))
    openSource: OpenSource | null = null
    // Stops the job's source on the pipeline, once it was sent.
    stopOnPipeline: (() => void) | null = null

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
        this._markCancelled()
        this._results.push(null)
        this.openSource?.inbox.push(CANCELLED)
        // So that a cancelled live source stops on the pipeline instead of running until the socket closes.
        this.stopOnPipeline?.()
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

/**
 * Runs jobs on up to `pipelineSockets` sockets to the pipeline API; connecting opens the first. A
 * socket's pipeline plays its sources one after another, so a batch on one socket leaves the GPU
 * mostly idle. While every open socket has a source and fewer than `pipelineSockets` are open, the next
 * job opens another; each job goes on the socket that has room and the fewest open sources.
 */
export class PipelineBackend implements WorkerBackend {
    private _pipelineApiUrl: string | null = null
    private _sockets: PipelineSocket[] = []
    private _connecting: Promise<PipelineSocket> | null = null
    // Every job's setSource and every changePop goes out through this chain, in the order submitted.
    private _sendChain: Promise<unknown> = Promise.resolve()
    private _disconnecting = false
    private _nextId = 0
    private _currentPop: Pop | null
    private readonly _warned = new Set<string>()
    private _noExtraSocketUntil = 0
    // Reconnects at once since a source last played.
    private _reconnects = 0

    constructor(private readonly ctx: WorkerContext) {
        this._currentPop = ctx.options.pop ?? null
    }

    // Connection

    public async reconnect(): Promise<void> {
        this._disconnecting = false
        await this.inOrder(() => this.ensureSocket())
        this.ctx.updateState()
    }

    public async disconnect(closeEndpoint: () => Promise<void>): Promise<void> {
        // The endpoint's jobs end first; then the socket, which stops whatever still runs on it.
        await closeEndpoint()
        this._disconnecting = true
        const sockets = this._sockets
        this._sockets = []
        for (const socket of sockets) {
            socket.ws.close(1000)
            await socket.closed
        }
    }

    public onStatus(_statusCode: number): void {}

    public popName(): string | null {
        return null
    }

    public async authorizationHeader(): Promise<string> {
        return this.ctx.credentialHeader()
    }

    private inOrder<T>(work: () => Promise<T>): Promise<T> {
        const result = this._sendChain.then(work)
        this._sendChain = result.catch(() => undefined)
        return result
    }

    private openSockets(): PipelineSocket[] {
        return this._sockets.filter(socket => socket.open)
    }

    /** An open socket, or a new one with the last pop set on it. */
    private async ensureSocket(): Promise<PipelineSocket> {
        const open = this.openSockets()[0]
        if (open !== undefined) {
            return open
        }
        if (this._connecting === null) {
            this._connecting = this.openSocket(true).finally(() => (this._connecting = null))
        }
        return await this._connecting
    }

    /**
     * The socket for the next job; the caller runs it in submission order. A live job goes on a socket
     * of its own, an idle one or a new one, which `pipelineSockets` does not count. Any other job skips
     * the sockets with a live source: a new one while every other socket has a source and fewer than
     * `pipelineSockets` are open, else the one with room and the fewest sources.
     */
    private async socketForJob(job: PipelineJob): Promise<PipelineSocket> {
        if (job.live) {
            return this.openSockets().find(socket => socket.held.size === 0) ?? (await this.openSocket(true))
        }
        const sockets = this.openSockets().filter(socket => socket.lives.size === 0)
        if (sockets.length === 0) {
            return await this.openSocket(true)
        }
        if (sockets.length < (this.ctx.options.pipelineSockets ?? PIPELINE_SOCKETS) && sockets.every(socket => socket.held.size > 0) && Date.now() >= this._noExtraSocketUntil) {
            try {
                return await this.openSocket(false)
            } catch (error) {
                // The open sockets take the job, and the jobs after it until the wait is over, so a
                // full pipeline API is not asked for a socket once per job.
                this._noExtraSocketUntil = Date.now() + EXTRA_SOCKET_RETRY_MS
                this.ctx.requestLogger.info('could not open another pipeline API socket: %s', error)
            }
        }
        const rank = (socket: PipelineSocket) => (socket.hasRoom ? 0 : MAX_OPEN_SOURCES + 1) + socket.held.size
        return sockets.reduce((best, socket) => (rank(socket) < rank(best) ? socket : best))
    }

    /** A new socket with the last pop set on it; `patient` waits through 503 with Retry-After. */
    private async openSocket(patient: boolean): Promise<PipelineSocket> {
        if (this.ctx.client() === null) {
            throw new PipelineSocketClosedError(undefined, 'the endpoint is not connected')
        }
        const ws = await this.upgrade(await this.socketUrl(), patient)
        const socket = new PipelineSocket(ws)
        ws.onmessage = (event: MessageEvent) => {
            if (typeof event.data === 'string') {
                try {
                    this.dispatch(socket, JSON.parse(event.data))
                } catch (error) {
                    this.ctx.logger.warn('unreadable message from the pipeline API: %s', error)
                }
            }
        }
        ws.onerror = () => {}
        ws.onclose = (event: CloseEvent) => this.closed(socket, event.code, event.reason)
        this._sockets.push(socket)
        this.startHeartbeat(socket)
        if (this._currentPop !== null) {
            try {
                await this.setPopOn(socket, this._currentPop)
            } catch (error) {
                // A socket whose pipeline does not run the pop runs no job.
                this._sockets = this._sockets.filter(other => other !== socket)
                ws.close(1000)
                throw error
            }
        }
        return socket
    }

    private startHeartbeat(socket: PipelineSocket): void {
        // A ping keeps the connection alive, nothing else; only Node's ws can send one.
        const ws = socket.ws
        const ping = (ws as any).ping
        if (typeof ping === 'function') {
            socket.heartbeat = setInterval(() => {
                if (ws.readyState === 1) {
                    ping.call(ws)
                }
            }, HEARTBEAT_MS)
            ;(socket.heartbeat as any).unref?.()
        }
    }

    private async socketUrl(): Promise<string> {
        if (this._pipelineApiUrl === null) {
            const base = this.ctx.options.isLocalMode ? this.ctx.eyepopUrl() : new URL(await this.configuredPipelineApiUrl(), this.ctx.eyepopUrl() + '/').toString()
            this._pipelineApiUrl = checkedUrl(base)
        }
        return 'ws' + this._pipelineApiUrl.slice('http'.length) + PIPELINE_PATH
    }

    private async configuredPipelineApiUrl(): Promise<string> {
        const client = this.ctx.client()
        if (client === null) {
            throw new Error('endpoint not connected')
        }
        let configUrl = `${this.ctx.eyepopUrl()}/v1/configs`
        const accountId = this.ctx.options.accountId
        if (accountId) {
            configUrl += `?account_uuid=${encodeURIComponent(accountId)}`
        }
        const response = await this.ctx.fetchWithRetry(async () => client.fetch(configUrl, { headers: { Authorization: await this.ctx.credentialHeader() } }))
        if (!response.ok) {
            throw new Error(`Unexpected status ${response.status} for GET ${configUrl}: ${await response.text()}`)
        }
        const config = await response.json()
        const url = config?.['pipeline_api_url']
        if (!url) {
            throw new PipelineConfigurationError('no_pipeline_api_url', `${configUrl} has no pipeline_api_url: this compute API serves no pipeline API`)
        }
        return url
    }

    private async token(): Promise<string | undefined> {
        if ((resolveAuth(this.ctx.options) as LocalAuth | undefined)?.isLocal !== undefined) {
            return undefined
        }
        return (await this.ctx.credentialHeader()).replace(/^Bearer /, '')
    }

    /** Open the socket, waiting through 503 with Retry-After and exchanging the API key again after a 401. */
    private async upgrade(url: string, patient: boolean): Promise<WebSocket> {
        const deadline = Date.now() + MAX_RETRY_MS
        let rejected = false
        while (true) {
            try {
                this.ctx.requestLogger.debug('before upgrade %s', url)
                return await openAuthorizedWebSocket(url, SUBPROTOCOL, await this.token())
            } catch (error) {
                if (!(error instanceof UpgradeError)) {
                    throw error
                }
                if (error.status === 401 && !rejected) {
                    this.ctx.requestLogger.debug('the pipeline API answered 401, authenticating again')
                    rejected = true
                    this.ctx.forgetCredential()
                    continue
                }
                const wait = error.status === 503 && error.retryAfter !== undefined ? Math.max(error.retryAfter, 1) * 1000 : undefined
                if (!patient || wait === undefined || Date.now() + wait > deadline) {
                    throw error
                }
                this.ctx.requestLogger.info('the pipeline API answered 503, retrying in %d ms', wait)
                await new Promise(resolve => setTimeout(resolve, wait))
            }
        }
    }

    private closed(socket: PipelineSocket, code: number | undefined, reason: string): void {
        socket.markClosed()
        this._sockets = this._sockets.filter(other => other !== socket)
        const error = new PipelineSocketClosedError(code, reason)
        socket.sources.forEach(source => source.close(error))
        socket.commands.forEach(command => command.reject(error))
        socket.commands.clear()
        if (this._disconnecting) {
            return
        }
        this.ctx.requestLogger.debug('the pipeline API closed the socket: %s %s', code, reason)
        if (RECONNECT_AT_ONCE.has(`${code} ${reason}`)) {
            if (reason === 'credential_expired') {
                this.ctx.forgetCredential()
            }
            // The first reconnect is at once. Should the new socket be closed the same way before a
            // source plays on it, each next one waits twice as long, so a pipeline API that keeps
            // closing is not reconnected to in a loop.
            const delay = this._reconnects === 0 ? 0 : Math.min(1000 * 2 ** (this._reconnects - 1), MAX_RECONNECT_DELAY_MS)
            this._reconnects += 1
            new Promise(resolve => setTimeout(resolve, delay))
                .then(() => (this._disconnecting ? undefined : this.inOrder(() => this.ensureSocket())))
                .catch(error => {
                    // The next job or changePop tries again and reports what fails.
                    this.ctx.requestLogger.info('could not reopen the pipeline API socket: %s', error)
                })
        }
    }

    private dispatch(socket: PipelineSocket, message: Message): void {
        const type = message['type']
        const id = message['id']
        const source = typeof id === 'string' ? socket.sources.get(id) : undefined
        if (type === 'end') {
            // Also the end of a source its job already let go, a cancelled one: it frees room all the same.
            socket.held.delete(id)
            socket.lives.delete(id)
            socket.freed()
        } else if (type === 'error' && message['error'] !== 'unknown_command') {
            // A refused setSource, also one whose job was cancelled before the refusal arrived: no end follows.
            // unknown_command answers a stopSource on a pipeline API from before it, for a source still open.
            socket.held.delete(id)
            socket.lives.delete(id)
            socket.wake()
        }
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
            if (type === 'start') {
                this._reconnects = 0
            }
            if (type === 'end') {
                source.uploads.forEach(upload => upload.end())
            }
            source.inbox.push(message)
        } else if (type === 'error') {
            if (id === undefined) {
                this.ctx.logger.warn('the pipeline API refused a message: %s %s', message['error'], message['message'])
            } else {
                // A stopSource for a source that ended meanwhile, or one a pipeline API without
                // stopSource does not know: the job ended either way.
                this.ctx.requestLogger.debug('the pipeline API refused a command for %s: %s %s', id, message['error'], message['message'])
            }
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

    public pop(): Pop | null {
        return this._currentPop
    }

    /**
     * Set the pop on every open socket's pipeline; a pop the first refuses rejects, and the last pop it
     * took stays. shortcut: a refusal from a later socket, which the first took, leaves the earlier ones
     * on the new pop; a refusal is the pop's own fault, so every socket answers it alike.
     */
    public async changePop(pop: Pop): Promise<void> {
        if (this.ctx.client() === null) {
            this._currentPop = pop
            return
        }
        await this.inOrder(async () => {
            const sockets = this.openSockets()
            if (sockets.length > 0) {
                for (const socket of sockets) {
                    try {
                        await this.setPopOn(socket, pop)
                    } catch (error) {
                        // A socket that closed meanwhile gets the pop when one opens in its place.
                        if (!(error instanceof PipelineSocketClosedError)) {
                            throw error
                        }
                    }
                }
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

    public async submit(work: WorkerWork): Promise<ResultStream> {
        if (this.ctx.client() === null) {
            throw new Error('endpoint not connected, use connect()')
        }
        const sourceOptions = work.kind === 'source' ? (work.source as FileSource | StreamSource | PathSource) : undefined
        this.notSent({ motionDetect: work.params.motionDetect, videoMode: sourceOptions?.videoMode, rtspForceNonCompliantUrl: work.params.rtspForceNonCompliantUrl })
        const job = await this.jobOf(work)
        const limit = this.ctx.limit()
        await limit.acquire()
        this.ctx.updateState()
        this.run(job)
            .then(
                () => job.finish(),
                error => job.finish(error instanceof Error ? error : new Error(String(error))),
            )
            .finally(() => this.ctx.jobDone())
        return job
    }

    private notSent(options: Record<string, unknown>): void {
        for (const [name, value] of Object.entries(options)) {
            if (value === undefined || this._warned.has(name)) {
                continue
            }
            this._warned.add(name)
            const ticket = name === 'rtspForceNonCompliantUrl' ? '' : ' (AWSU-317)'
            this.ctx.logger.warn(`${name} is not sent to the pipeline API and has no effect in pipeline mode${ticket}`)
        }
    }

    private async jobOf(work: WorkerWork): Promise<PipelineJob> {
        switch (work.kind) {
            case 'source':
                return await this.sourceJob(work.source, work.params)
            case 'uploadGroup': {
                const media = await Promise.all(work.paths.map(path => this.pathMedia({ path })))
                return new PipelineJob(uploadGroup(media), media, false, work.params)
            }
            case 'uploadStreamGroup': {
                const media = work.streams.map((stream, i) => bodyMedia(stream, work.mimeTypes?.[i] ?? 'application/octet-stream', undefined))
                return new PipelineJob(uploadGroup(media), media, false, work.params)
            }
            case 'loadFromGroup':
                return new PipelineJob({ group: work.urls.map(url => ({ url })) }, [], false, work.params)
        }
    }

    private async sourceJob(source: Source, params: ProcessParams): Promise<PipelineJob> {
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
                return await this.sourceJob({ path: url.substring('file://'.length) }, params)
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
        const options = this.ctx.options
        const resolve = async () => (options.platformSupport?.resolvePath ? await options.platformSupport.resolvePath(source, this.ctx.logger) : await resolvePath(source, this.ctx.logger))
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

    /**
     * Run the job's source to its end. A live source refused overloaded goes once more on a new socket.
     * A source refused queue_full goes again once another source on the socket ended, so it may go after
     * jobs submitted later; with none of the endpoint's other sources open there, or with an upload from
     * the caller's own stream, which cannot be read twice, the refusal stands.
     */
    private async run(job: PipelineJob): Promise<void> {
        let retried = false
        while (true) {
            const sent = await this.inOrder(() => this.setSource(job))
            if (sent === null) {
                return
            }
            const { socket, source } = sent
            const uploading = source.uploads.size > 0 ? this.upload(socket, source, job) : Promise.resolve()
            let whip: SocketWhip | null = null
            let refused: string | null
            try {
                refused = await this.follow(job, source, () => {
                    if (job.mediaStream !== undefined) {
                        // A WHIP that fails leaves the live source waiting for media it never gets, so the
                        // failure stops it on the pipeline as well as ending the job.
                        const fail = (error: unknown) => {
                            job.stopOnPipeline?.()
                            source.inbox.push(error instanceof Error ? error : new Error(String(error)))
                        }
                        whip = new SocketWhip(job.mediaStream, job.source['whip']['ingressId'], message => this.command(socket, message), fail, this.ctx.requestLogger)
                        whip.start().catch(fail)
                    }
                })
            } finally {
                job.openSource = null
                job.stopOnPipeline = null
                socket.sources.delete(source.id)
                source.uploads.forEach(upload => upload.end())
                await uploading
                await (whip as SocketWhip | null)?.close()
            }
            if (refused === null) {
                return
            }
            if (refused === 'queue_full') {
                if (socket.held.size === 0 && socket.ended === source.endedBefore) {
                    throw new PipelineCommandError('queue_full', 'the socket refused the source with none of its own open')
                }
                if (job.media.some(media => media.once)) {
                    throw new PipelineCommandError('queue_full', 'the socket refused an upload from a stream, which cannot be sent again')
                }
                // Sources whose refusal is still on its way count too, until it arrives.
                socket.cap = Math.min(socket.held.size, socket.cap ?? socket.held.size) || null
                continue
            }
            if (retried || !job.live) {
                throw new PipelineCommandError('overloaded', 'the pipeline API has no capacity for another live source')
            }
            retried = true
            await socket.closed
        }
    }

    /** Send the job's setSource; the caller runs it in submission order. */
    private async setSource(job: PipelineJob): Promise<{ socket: PipelineSocket; source: OpenSource } | null> {
        if (job.cancelled) {
            // Cancelled before its turn: never sent, so it takes no source on the pipeline.
            return null
        }
        const combined = await combinedMedia(job)
        let socket: PipelineSocket
        while (true) {
            socket = await this.socketForJob(job)
            await socket.room(job)
            if (job.cancelled) {
                return null
            }
            if (socket.open) {
                break
            }
            // It closed while the send waited for room: pick again.
        }
        const source = new OpenSource(this.newId('source'))
        if (combined === null) {
            uploadKeys(job).forEach(key => source.uploads.set(key, new Credit()))
        }
        socket.sources.set(source.id, source)
        socket.held.add(source.id)
        if (job.live) {
            socket.lives.add(source.id)
        }
        source.endedBefore = socket.ended
        job.openSource = source
        job.stopOnPipeline = () => {
            if (socket.open) {
                socket.sendJson({ type: 'stopSource', id: source.id })
            }
        }
        const command = job.command(source.id)
        if (combined === null) {
            socket.sendJson(command)
        } else {
            socket.sendBytes(combinedMessage(command, combined))
        }
        return { socket, source }
    }

    /** Hand the source's predictions to the job until it ends; the refusal to retry on, overloaded or queue_full. */
    private async follow(job: PipelineJob, source: OpenSource, onResult: () => void): Promise<string | null> {
        while (true) {
            if (job.cancelled) {
                return null
            }
            const message = await source.inbox.next()
            if (message === CANCELLED) {
                return null
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
                        return null
                    }
                    throw new PipelineSourceError(source.id, message['reason'] ?? '', message['message'] ?? '')
                case 'error':
                    if (message['error'] === 'overloaded' || message['error'] === 'queue_full') {
                        return message['error']
                    }
                    throw new PipelineCommandError(message['error'] ?? '', message['message'] ?? '')
                case 'dropped':
                    this.ctx.requestLogger.debug('the pipeline API dropped %s predictions of a live source', message['count'])
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

    public async session(): Promise<WorkerSession> {
        const token = await this.token()
        // The token's own expiry, so that a client handed this session knows when it runs out; a
        // local pipeline API takes no token, and an access token given as is has no known expiry.
        const validUntil = token === undefined ? Number.MAX_VALUE : Math.min((await this.ctx.credentialSession()).validUntil, Number.MAX_VALUE)
        return {
            eyepopUrl: this.ctx.eyepopUrl(),
            accessToken: token ?? '',
            validUntil,
            popId: 'transient',
            accountId: this.ctx.options.accountId,
            baseUrl: this._pipelineApiUrl ?? undefined,
            pipelineId: undefined,
            isPipelineMode: true,
            authenticationHeaders: () => (token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        }
    }
}

/**
 * WHIP signalled over the socket (spec 019): ICE servers, the offer and each local candidate go
 * as `whipIceServers`, `whipOffer` and `whipIce` for the source's ingress; the media goes over WebRTC.
 * A connection that fails is reported through `fail`, since the pipeline only hears no media.
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
        private readonly _fail: (error: Error) => void,
        private readonly _logger: { debug: (...args: any[]) => void },
    ) {}

    async start(): Promise<void> {
        const servers = await this._command({ type: 'whipIceServers', ingressId: this._ingressId })
        const iceServers = (servers['iceServers'] as string[] | undefined) ?? []
        // Only the urls: a TURN server's entry carries its credential.
        this._logger.debug('whip %s: ice servers %j', this._ingressId, iceServers.map(server => server.split(';')[0]))
        const pc = new RTCPeerConnection({ iceServers: WebrtcBase.linkToIceServers(iceServers.join(', ') || null) })
        this._pc = pc
        pc.oniceconnectionstatechange = () => {
            this._logger.debug('whip %s: ice connection %s', this._ingressId, pc.iceConnectionState)
            if (pc.iceConnectionState === 'failed' && this._pc === pc) {
                this._fail(
                    new Error(
                        `the WebRTC connection of whip ingress ${this._ingressId} failed: no candidate pair connected, ` +
                            `so the pipeline API is likely reachable through no STUN or TURN server (ice servers: ${iceServers.length})`,
                    ),
                )
            }
        }
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
        throw new PipelineConfigurationError('insecure_url', `the pipeline API url ${url} must be an http or https url`)
    }
    if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
        throw new PipelineConfigurationError('insecure_url', `the pipeline API url ${url} must use https unless its host is a loopback address`)
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
    const once = !(typeof Blob !== 'undefined' && body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)
    return { open: async () => body, contentType, size: size ?? knownSize(body), once }
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
