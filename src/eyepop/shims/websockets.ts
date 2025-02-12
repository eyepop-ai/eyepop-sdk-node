export let createWebSocket: (url: string | URL, protocols?: string | string[]) => WebSocket

if ('document' in globalThis && 'implementation' in globalThis.document) {
    createWebSocket = (url: string | URL, protocols?: string | string[]) => {
        return new WebSocket(url, protocols)
    }
} else {
    createWebSocket = (url: string | URL, protocols?: string | string[]) => {
        const ws = require('ws')
        return new ws.WebSocket(url, protocols)
    }
}
