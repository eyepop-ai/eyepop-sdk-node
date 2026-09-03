import { once } from 'node:events'
import { createServer } from 'node:net'

import { afterEach, describe, expect, test } from '@jest/globals'
import { ServerOptions, WebSocketServer } from 'ws'

import { EyePop } from '../../../src/eyepop'
import { HttpClient } from '../../../src/eyepop/options'

async function connectionRefusingServer(): Promise<{ url: string; close: () => Promise<void> }> {
    const server = createServer(socket => socket.destroy())
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (typeof address === 'string' || address === null) {
        throw new Error('Expected the test server to bind a TCP port')
    }
    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}

async function listeningWebSocketServer(options: Omit<ServerOptions, 'port'> = {}): Promise<{ server: WebSocketServer; url: string }> {
    const server = new WebSocketServer({ ...options, port: 0 })
    await once(server, 'listening')
    const address = server.address()
    if (typeof address === 'string' || address === null) {
        throw new Error('Expected the test WebSocket server to bind a TCP port')
    }
    return { server, url: `http://127.0.0.1:${address.port}` }
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${description}`)
        }
        await new Promise(resolve => setTimeout(resolve, 25))
    }
}

function dataConfigClient(datasetApiUrl: string): HttpClient {
    return {
        async fetch() {
            return new Response(JSON.stringify({ dataset_api_url: datasetApiUrl, vlm_api_url: datasetApiUrl }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        },
        async close() {},
        isFullDuplex() {
            return false
        },
    }
}

function testEndpoint(datasetApiUrl: string) {
    return EyePop.dataEndpoint({
        eyepopUrl: 'https://compute.eyepop.ai',
        accessToken: 'test-token',
        accountId: 'test-account',
        platformSupport: {
            createHttpClient: async () => dataConfigClient(datasetApiUrl),
            resolvePath: async () => {
                throw new Error('Path resolution is not used by this test')
            },
        },
    })
}

describe('Dataset event WebSocket lifecycle', () => {
    const endpoints: ReturnType<typeof EyePop.dataEndpoint>[] = []

    afterEach(async () => {
        await Promise.all(endpoints.splice(0).map(endpoint => endpoint.disconnect(false)))
    })

    test('connection failure rejects with a structured error carrying the source error', async () => {
        const { url, close } = await connectionRefusingServer()
        const endpoint = testEndpoint(url)
        endpoints.push(endpoint)

        let connectionError: unknown
        try {
            await endpoint.connect()
        } catch (error) {
            connectionError = error
        } finally {
            await close()
        }

        expect(connectionError).toBeInstanceOf(Error)
        expect(connectionError).toMatchObject({
            name: 'EyePopDataWebSocketError',
            code: 'DATA_WEBSOCKET_CONNECTION_FAILED',
        })
        const sourceError = (connectionError as { sourceError: { code?: unknown; message?: unknown } }).sourceError
        expect(typeof sourceError.code).toBe('string')
        expect(typeof sourceError.message).toBe('string')
        expect((connectionError as Error).message).toContain(sourceError.message as string)
    })

    test('a rejected connect leaves no reconnect timer behind', async () => {
        let connectionAttempts = 0
        const { server, url } = await listeningWebSocketServer({
            verifyClient: () => {
                connectionAttempts++
                return false
            },
        })
        const endpoint = testEndpoint(url)
        endpoints.push(endpoint)

        try {
            await expect(endpoint.connect()).rejects.toMatchObject({ name: 'EyePopDataWebSocketError' })
            expect(connectionAttempts).toBe(1)

            await new Promise(resolve => setTimeout(resolve, 1750))

            expect(connectionAttempts).toBe(1)
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    }, 15000)

    test('failed background reconnect retries without creating an unhandled rejection', async () => {
        let connectionAttempts = 0
        const { server, url } = await listeningWebSocketServer({
            verifyClient: () => {
                connectionAttempts++
                return connectionAttempts === 1
            },
        })
        const endpoint = testEndpoint(url)
        endpoints.push(endpoint)
        await endpoint.connect()

        const unhandledRejections: unknown[] = []
        const recordUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
        process.on('unhandledRejection', recordUnhandledRejection)

        try {
            for (const client of server.clients) {
                client.close(1012, 'service restart')
            }
            await waitFor(() => connectionAttempts >= 3, 'the rejected background reconnect attempts to keep retrying')
            await new Promise(resolve => setTimeout(resolve, 100))

            expect(unhandledRejections).toEqual([])
        } finally {
            process.off('unhandledRejection', recordUnhandledRejection)
            await endpoint.disconnect(false)
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    }, 15000)

    test('reconnect resubscribes the registered datasets', async () => {
        const { server, url } = await listeningWebSocketServer()
        const messagesPerConnection: string[][] = []
        server.on('connection', socket => {
            const received: string[] = []
            messagesPerConnection.push(received)
            socket.on('message', data => received.push(data.toString()))
        })

        const endpoint = testEndpoint(url)
        endpoints.push(endpoint)

        try {
            await endpoint.connect()
            endpoint.addDatasetEventHandler('dataset-under-test', async () => {})

            for (const client of server.clients) {
                client.close(1012, 'service restart')
            }
            await waitFor(() => messagesPerConnection.length >= 2, 'the background reconnect')

            const subscribeMessage = JSON.stringify({ subscribe: { dataset_uuid: 'dataset-under-test' } })
            await waitFor(() => messagesPerConnection[1].includes(subscribeMessage), 'the replayed dataset subscription')

            expect(messagesPerConnection[1]).toContain(subscribeMessage)
        } finally {
            await endpoint.disconnect(false)
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    }, 15000)

    test('intentional disconnect cancels a pending reconnect', async () => {
        const { server, url } = await listeningWebSocketServer()
        let connectionCount = 0
        server.on('connection', () => connectionCount++)

        const endpoint = testEndpoint(url)
        endpoints.push(endpoint)

        try {
            await endpoint.connect()
            expect(connectionCount).toBe(1)

            const clientClosed = Promise.all(Array.from(server.clients, client => once(client, 'close')))
            for (const client of server.clients) {
                client.close(1012, 'service restart')
            }
            await clientClosed
            await endpoint.disconnect(false)
            await new Promise(resolve => setTimeout(resolve, 1750))

            expect(connectionCount).toBe(1)
        } finally {
            await endpoint.disconnect(false)
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    }, 15000)
})
