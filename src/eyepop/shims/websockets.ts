export let createWebSocket: (url: string | URL, protocols?: string | string[]) => WebSocket

/**
 * The pipeline API refused the upgrade: `status` and `retryAfter` (seconds) when the runtime reports
 * them, which a browser never does.
 */
export class UpgradeError extends Error {
    readonly status: number | undefined
    readonly retryAfter: number | undefined

    constructor(message: string, status?: number, retryAfter?: number) {
        super(message)
        this.name = 'UpgradeError'
        this.status = status
        this.retryAfter = retryAfter
    }
}

/**
 * Opens a socket to the pipeline API, resolving once it is open. The token goes as the
 * `Authorization` header where the runtime can set one (Node), and otherwise as the
 * `eyepop.bearer.<jwt>` subprotocol next to `protocol`, as a browser cannot set headers.
 */
export let openAuthorizedWebSocket: (url: string, protocol: string, token: string | undefined) => Promise<WebSocket>

const isBrowser = 'document' in globalThis && 'implementation' in globalThis.document

if (isBrowser) {
    createWebSocket = (url: string | URL, protocols?: string | string[]) => {
        return new WebSocket(url, protocols)
    }
    openAuthorizedWebSocket = (url: string, protocol: string, token: string | undefined) => {
        const protocols = token === undefined ? [protocol] : [protocol, `eyepop.bearer.${token}`]
        const ws = new WebSocket(url, protocols)
        ws.binaryType = 'arraybuffer'
        return new Promise((resolve, reject) => {
            ws.onopen = () => resolve(ws)
            ws.onerror = () => reject(new UpgradeError(`could not open ${url}`))
        })
    }
} else {
    createWebSocket = (url: string | URL, protocols?: string | string[]) => {
        const ws = require('ws')
        return new ws.WebSocket(url, protocols)
    }
    openAuthorizedWebSocket = (url: string, protocol: string, token: string | undefined) => {
        const ws = require('ws')
        const headers = token === undefined ? {} : { Authorization: `Bearer ${token}` }
        const socket = new ws.WebSocket(url, [protocol], { headers, maxPayload: 0 })
        socket.binaryType = 'arraybuffer'
        return new Promise((resolve, reject) => {
            socket.once('open', () => resolve(socket as WebSocket))
            socket.once('unexpected-response', (_request: any, response: any) => {
                const retryAfter = Number.parseFloat(response.headers?.['retry-after'])
                reject(new UpgradeError(`the pipeline API answered the upgrade ${response.statusCode}`, response.statusCode, Number.isFinite(retryAfter) ? retryAfter : undefined))
                response.resume()
                socket.terminate()
            })
            socket.once('error', (error: Error) => reject(new UpgradeError(`could not open ${url}: ${error.message}`)))
        })
    }
}
