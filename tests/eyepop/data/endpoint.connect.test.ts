import {EyePop, Session} from '../../../src/eyepop'

import {MockServer} from 'jest-mock-server'
import {WS} from 'jest-websocket-mock'

import {describe, expect, test} from '@jest/globals'
import {v4 as uuidv4} from 'uuid'

export { WebSocket as default } from "mock-socket";
describe('EyePopSdk endpoint module auth and connect', () => {
    const server = new MockServer()
    let ws_server:WS|null = null
    beforeAll(async () => {
        await server.start()
        const wsUrl = `${server.getURL().toString().replace("https://", "wss://").replace("http://", "ws://")}data/events`
        ws_server = new WS(wsUrl)
        // ws_server.on("connection", (socket: MockWebSocket) => {
        //
        // })
    })
    afterAll(async () => {
        ws_server?.close()
        await server.stop()
    })

    beforeEach(() => server.reset())

    const test_account_id = uuidv4()
    const test_secret_key = uuidv4()
    const test_access_token = uuidv4()
    const short_token_valid_time = 1
    const long_token_valid_time = 1000 * 1000

    test('EyePopSdk connect', async () => {

        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const dataConfigRoute = server
            .get(`/data/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}data/`})
            })


        const endpoint = EyePop.dataEndpoint({
            eyepopUrl: server.getURL().toString(),
            accountId: test_account_id,
            auth: {secretKey: test_secret_key}
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(dataConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk reuse token', async () => {
        const test_access_token = uuidv4()
        const long_token_valid_time = 1000 * 1000

        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const dataConfigRoute = server
            .get(`/data/config`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}data/`})
            })

        const endpoint = EyePop.dataEndpoint({
            eyepopUrl: server.getURL().toString(), accountId: test_account_id, auth: {secretKey: test_secret_key}
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(dataConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
        // token should be reused
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(dataConfigRoute).toHaveBeenCalledTimes(2)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk re-auth on expired token', async () => {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: short_token_valid_time,
                    token_type: 'Bearer'
                })
            })
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const dataConfigRoute = server
            .get(`/data/config`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}data/`})
            })
        const endpoint = EyePop.dataEndpoint({
            eyepopUrl: server.getURL().toString(), accountId: test_account_id, auth: {secretKey: test_secret_key}
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(2)
            expect(dataConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
        // token should have expired by now
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(2)
            expect(dataConfigRoute).toHaveBeenCalledTimes(2)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk re-auth on 401', async () => {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: short_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const dataConfigRoute = server
            .get(`/data/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 401
            })
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}data/`})
            })

        const endpoint = EyePop.dataEndpoint({
            eyepopUrl: server.getURL().toString(), accountId: test_account_id, auth: {secretKey: test_secret_key}
        })
        expect(endpoint).toBeDefined()
        try {
            expect(authenticationRoute).toHaveBeenCalledTimes(0)
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(3)
            expect(dataConfigRoute).toHaveBeenCalledTimes(2)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk auth with session', async () => {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const dataConfigRoute = server
            .get(`/data/config`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}data/`})
            })

        const endpoint1 = EyePop.dataEndpoint({
            eyepopUrl: server.getURL().toString(), accountId: test_account_id, auth: {secretKey: test_secret_key}
        })
        expect(endpoint1).toBeDefined()

        let session: Session

        try {
            await endpoint1.connect()
            session = await endpoint1.session()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(dataConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint1.disconnect()
        }

        authenticationRoute.mockClear()
        dataConfigRoute.mockClear()

        const endpoint2 = EyePop.dataEndpoint({
            eyepopUrl: server.getURL().toString(), accountId: test_account_id, auth: {session: session}
        })
        expect(endpoint2).toBeDefined()

        try {
            await endpoint2.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(0)
            expect(dataConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint2.disconnect()
        }

    })
})
