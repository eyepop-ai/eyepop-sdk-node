/**
 * A fake pipeline API and compute API for pipeline mode, the TypeScript port of the Python SDK's
 * fake (eyepop-sdk-python #286), on one http server.
 *
 * The socket follows eyepop-instance spec 019, `contracts/socket.md`: setPop, setSource (url,
 * assetUuid, upload, group, whip; combined and chunked), uploaded, the WHIP commands and quit.
 * The compute routes are `/v1/auth/authenticate`, which mints a new token each time, and
 * `/v1/configs`, which names this server as the pipeline API.
 */
import * as http from 'node:http'
import { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'

export function prediction(n: number): Record<string, any> {
    return { timestamp: n, source_width: 640, source_height: 480, objects: [{ classLabel: 'person' }] }
}

type Message = Record<string, any>

export interface FakeSocket {
    authorization: string | undefined
    protocols: string[]
    commands: Message[]
    media: Map<string, Map<number | null, Buffer>>
    combined: string[]
}

export function sources(socket: FakeSocket): Message[] {
    return socket.commands.filter(c => c['type'] === 'setSource')
}

export function pops(socket: FakeSocket): unknown[] {
    return socket.commands.filter(c => c['type'] === 'setPop').map(c => c['pop'])
}

/**
 * A source plays `frames` predictions and ends eos; a url with `bad` in it ends with reason error; a
 * live source predicts until the socket closes. Scripted behaviour: `upgradeAnswers` refuse
 * upgrades first, `refusals` answer setSources with an error, `closes` close a socket after that
 * many of its setSources were answered, `idleAfterDone` closes it `1000 idle` once it has no open
 * source, `overloadedLive` refuses that many live setSources `overloaded` and closes
 * `1011 overloaded`, and `closeOnOpen` closes every socket as soon as it opens.
 */
export class FakePipelineApi {
    frames = 2
    window = 16
    sockets: FakeSocket[] = []
    upgradeAnswers: Array<{ status: number; headers?: Record<string, string> }> = []
    refusals: string[] = []
    popError: string | null = null
    closes = new Map<number, [number, string]>()
    idleAfterDone = false
    overloadedLive = 0
    closeOnOpen: [number, string] | null = null
    pipelineApiUrl: string | null | undefined = undefined
    exchanges: Array<string | undefined> = []
    configAuthorizations: Array<string | undefined> = []
    expiresIn = 3600

    private readonly _server = http.createServer((request, response) => this.route(request, response))
    private readonly _wss = new WebSocketServer({ noServer: true, handleProtocols: protocols => (protocols.has('eyepop.v1') ? 'eyepop.v1' : false) })
    private readonly _open = new Set<WebSocket>()

    constructor() {
        this._server.on('upgrade', (request, socket, head) => {
            const answer = this.upgradeAnswers.shift()
            if (answer !== undefined) {
                const headers = Object.entries(answer.headers ?? {})
                    .map(([k, v]) => `${k}: ${v}\r\n`)
                    .join('')
                socket.end(`HTTP/1.1 ${answer.status} Refused\r\n${headers}Content-Length: 0\r\n\r\n`)
                return
            }
            this._wss.handleUpgrade(request, socket, head, ws => {
                const fake: FakeSocket = {
                    authorization: request.headers['authorization'],
                    protocols: (request.headers['sec-websocket-protocol'] ?? '')
                        .split(',')
                        .map(p => p.trim())
                        .filter(p => p),
                    commands: [],
                    media: new Map(),
                    combined: [],
                }
                this.sockets.push(fake)
                this._open.add(ws)
                ws.on('close', () => this._open.delete(ws))
                if (this.closeOnOpen !== null) {
                    ws.close(...this.closeOnOpen)
                    return
                }
                new Run(this, fake, ws)
            })
        })
    }

    get url(): string {
        return `http://127.0.0.1:${(this._server.address() as AddressInfo).port}`
    }

    async start(): Promise<void> {
        await new Promise<void>(resolve => this._server.listen(0, '127.0.0.1', resolve))
    }

    async stop(): Promise<void> {
        this._open.forEach(ws => ws.terminate())
        this._wss.close()
        await new Promise<void>(resolve => this._server.close(() => resolve()))
    }

    get minted(): string[] {
        return this.exchanges.map((_, i) => `minted-${i + 1}`)
    }

    private route(request: http.IncomingMessage, response: http.ServerResponse): void {
        const json = (body: unknown) => {
            response.writeHead(200, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify(body))
        }
        if (request.method === 'POST' && request.url === '/v1/auth/authenticate') {
            this.exchanges.push(request.headers['authorization'])
            json({ access_token: `minted-${this.exchanges.length}`, expires_in: this.expiresIn, token_type: 'Bearer' })
        } else if (request.method === 'GET' && request.url?.startsWith('/v1/configs')) {
            this.configAuthorizations.push(request.headers['authorization'])
            const config: Message = { dataset_api_url: 'https://dataset-api.example' }
            const url = this.pipelineApiUrl === undefined ? this.url : this.pipelineApiUrl
            if (url !== null) {
                config['pipeline_api_url'] = url
            }
            json(config)
        } else {
            response.writeHead(404)
            response.end()
        }
    }
}

/** One socket's server side. */
class Run {
    private readonly _open: string[] = []
    private _answered = 0
    private readonly _queue: Array<[string, Message]> = []
    private _playing = false
    // Chunked uploads in line, as [id, member]; the first one is sending.
    private readonly _uploads: Array<[string, number | null]> = []
    private readonly _missing = new Map<string, number>()
    private readonly _commands = new Map<string, Message>()

    constructor(
        private readonly _fake: FakePipelineApi,
        private readonly _socket: FakeSocket,
        private readonly _ws: WebSocket,
    ) {
        _ws.on('message', (data: Buffer, isBinary: boolean) => {
            if (isBinary) {
                this.binary(data)
            } else {
                this.command(JSON.parse(data.toString()))
            }
        })
    }

    private send(message: Message): void {
        if (this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(message))
        }
    }

    private close(code: number, reason: string): void {
        this._ws.close(code, reason)
    }

    private command(command: Message): void {
        this._socket.commands.push(command)
        const id = command['id']
        switch (command['type']) {
            case 'setPop':
                if (this._fake.popError) {
                    this.send({ type: 'error', id, error: this._fake.popError, message: 'no such ability' })
                } else {
                    this.send({ type: 'result', id })
                }
                break
            case 'setSource':
                this.setSource(command, null)
                break
            case 'uploaded': {
                const head = this._uploads[0]
                if (head !== undefined && head[0] === id && head[1] === (command['member'] ?? null)) {
                    this._uploads.shift()
                    const missing = (this._missing.get(id) ?? 1) - 1
                    this._missing.set(id, missing)
                    if (missing === 0) {
                        this.play(id, this._commands.get(id) as Message)
                    }
                    this.nextUpload()
                }
                break
            }
            case 'whipIceServers':
                this.send({ type: 'result', id, iceServers: ['<stun:stun.example:3478>; rel="ice-server"'] })
                break
            case 'whipOffer':
                this.send({ type: 'result', id, sdp: `answer to ${command['sdp']}` })
                break
            case 'whipIce':
                this.send({ type: 'result', id })
                break
            case 'quit':
                this._ws.close()
                break
            default:
                this.send({ type: 'error', id, error: 'unknown_command', message: command['type'] })
        }
    }

    private binary(data: Buffer): void {
        if (data[0] === 0x01) {
            const [id, member] = this._uploads[0] as [string, number | null]
            const media = this._socket.media.get(id) as Map<number | null, Buffer>
            media.set(member, Buffer.concat([media.get(member) ?? Buffer.alloc(0), data.subarray(1)]))
            this.send({ type: 'credit', id, bytes: data.length - 1, ...(member === null ? {} : { member }) })
            return
        }
        const length = data.readUInt32BE(1)
        const command = JSON.parse(data.subarray(5, 5 + length).toString())
        this._socket.commands.push(command)
        this._socket.combined.push(command['id'])
        this.setSource(command, data.subarray(5 + length))
    }

    private setSource(command: Message, combined: Buffer | null): void {
        const id = command['id']
        const refusal = this._fake.refusals.shift()
        if (refusal !== undefined) {
            this.send({ type: 'error', id, error: refusal, message: 'refused' })
            return
        }
        if (isLive(command) && this._fake.overloadedLive > 0) {
            this._fake.overloadedLive -= 1
            this.send({ type: 'error', id, error: 'overloaded', message: 'max-live' })
            this.close(1011, 'overloaded')
            return
        }
        this._open.push(id)
        this._commands.set(id, command)
        this._socket.media.set(id, new Map())
        this.send({ type: 'result', id })
        this._answered += 1
        const close = this._fake.closes.get(this._answered)
        if (close !== undefined) {
            this._fake.closes.delete(this._answered)
            this.close(...close)
            return
        }
        const members = uploadMembers(command)
        if (combined !== null) {
            let rest = combined
            for (const [member, size] of members) {
                const n = size ?? rest.length
                this._socket.media.get(id)?.set(member, rest.subarray(0, n))
                rest = rest.subarray(n)
            }
            this.play(id, command)
        } else if (members.length > 0) {
            this._missing.set(id, members.length)
            const sending = this._uploads.length > 0
            members.forEach(([member]) => this._uploads.push([id, member]))
            if (!sending) {
                this.nextUpload()
            }
        } else {
            this.play(id, command)
        }
    }

    private nextUpload(): void {
        const head = this._uploads[0]
        if (head !== undefined) {
            this.send({ type: 'send', id: head[0], credit: this._fake.window, ...(head[1] === null ? {} : { member: head[1] }) })
        }
    }

    private play(id: string, command: Message): void {
        this._queue.push([id, command])
        if (!this._playing) {
            this._playing = true
            setImmediate(() => this.playNext())
        }
    }

    private playNext(): void {
        const next = this._queue.shift()
        if (next === undefined) {
            this._playing = false
            return
        }
        const [id, command] = next
        this.send({ type: 'start', id })
        if (isLive(command)) {
            let n = 0
            const timer = setInterval(() => {
                if (this._ws.readyState !== WebSocket.OPEN) {
                    clearInterval(timer)
                    return
                }
                this.send({ type: 'prediction', id, prediction: prediction(n++) })
            }, 5)
            return
        }
        if (String(command['url'] ?? '').includes('bad')) {
            this.end(id, 'error', 'bad media')
        } else {
            for (let n = 0; n < this._fake.frames; n++) {
                this.send({ type: 'prediction', id, prediction: prediction(n) })
            }
            this.end(id, 'eos')
        }
        setImmediate(() => this.playNext())
    }

    private end(id: string, reason: string, message: string = ''): void {
        this._open.splice(this._open.indexOf(id), 1)
        this.send({ type: 'end', id, reason, ...(message ? { message } : {}) })
        if (this._open.length === 0) {
            this.send({ type: 'done' })
            if (this._fake.idleAfterDone) {
                this.close(1000, 'idle')
            }
        }
    }
}

function isLive(command: Message): boolean {
    return command['live'] === true || command['whip'] !== undefined || /^(rtsp|rtmp):\/\//.test(String(command['url'] ?? ''))
}

/** Each upload member's index (null for a single upload) and its combined bytes. */
function uploadMembers(command: Message): Array<[number | null, number | undefined]> {
    if (command['upload'] !== undefined) {
        return [[null, undefined]]
    }
    return ((command['group'] as Message[] | undefined) ?? []).flatMap(
        (member, i): Array<[number | null, number | undefined]> => (member['upload'] !== undefined ? [[i, member['upload']['bytes']]] : []),
    )
}
