import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

// these tests cover worker session mode; pipeline mode is the default
process.env['EYEPOP_PIPELINE_MODE'] = 'false'

function prepMockServer(server: MockServer, test_pop_id: string, test_pipeline_id: string) {
    const test_access_token = uuidv4()

    server.post('/v1/auth/authenticate').mockImplementation(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ access_token: test_access_token, expires_in: 1000 * 1000, token_type: 'Bearer' })
    })

    const popConfigRoute = server.get(`/pops/${test_pop_id}/config`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id })
    })

    server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ id: test_pipeline_id })
    })

    return { popConfigRoute }
}

describe('a source target resolution reaches the worker', () => {
    const server = new MockServer()
    const test_api_key = uuidv4()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('a target resolution travels with a URL source', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const { popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)
        const targetResolution = { width: 1280, height: 720 }

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            // @ts-ignore
            expect(ctx.request.body['targetResolution']).toEqual(targetResolution)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            const job = await endpoint.process({ source: { url: 'http://invalid.example' }, targetResolution })
            for await (const _ of job) {
                // drain
            }
            expect(loadFromRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a source without a target resolution sends none', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            // @ts-ignore
            expect(ctx.request.body['targetResolution']).toBeUndefined()
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            const job = await endpoint.process({ source: { url: 'http://invalid.example' } })
            for await (const _ of job) {
                // drain
            }
            expect(loadFromRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a target resolution out of range or not whole fails before the request', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            for (const targetResolution of [{ width: 63, height: 720 }, { width: 1280, height: 16385 }, { width: 1280.5, height: 720 }]) {
                await expect(endpoint.process({ source: { url: 'http://invalid.example' }, targetResolution })).rejects.toThrow()
            }
            await expect(endpoint.loadFromGroup(['http://invalid.example'], { targetResolution: { width: 32, height: 32 } })).rejects.toThrow()
            expect(loadFromRoute).toHaveBeenCalledTimes(0)
        } finally {
            await endpoint.disconnect()
        }
    })
})
