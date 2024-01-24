import {EyePopSdk} from '../src'

import {MockServer} from 'jest-mock-server'
import {describe, expect, test} from '@jest/globals'
import {v4 as uuidv4} from 'uuid'

describe('EyePopSdk endpoint module auth and connect', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    const test_pop_id = uuidv4()
    const test_pipeline_id = uuidv4()
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

        const popConfigRoute = server
            .get(`/pops/${test_pop_id}/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id})
            })

        const stopRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 204
            })

        const endpoint = EyePopSdk.endpoint({
            eyepopUrl: server.getURL().toString(), secretKey: test_secret_key, popId: test_pop_id
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk reuse token', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
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

        const popConfigRoute = server
            .get(`/pops/${test_pop_id}/config`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id})
            })

        server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementation((ctx) => {
                ctx.status = 204
            })

        const endpoint = EyePopSdk.endpoint({
            eyepopUrl: server.getURL().toString(), secretKey: test_secret_key, popId: test_pop_id
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
        // token should be reused
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(2)
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

        const popConfigRoute = server
            .get(`/pops/${test_pop_id}/config`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id})
            })

        const endpoint = EyePopSdk.endpoint({
            eyepopUrl: server.getURL().toString(), secretKey: test_secret_key, popId: test_pop_id, stopJobs: false
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
        // token should have expired by now
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(2)
            expect(popConfigRoute).toHaveBeenCalledTimes(2)
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

        const popConfigRoute = server
            .get(`/pops/${test_pop_id}/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 401
            })
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id})
            })

        server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementation((ctx) => {
                ctx.status = 204
            })

        const endpoint = EyePopSdk.endpoint({
            eyepopUrl: server.getURL().toString(), secretKey: test_secret_key, popId: test_pop_id, stopJobs: false
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(2)
            expect(popConfigRoute).toHaveBeenCalledTimes(2)
        } finally {
            await endpoint.disconnect()
        }
    })
})
