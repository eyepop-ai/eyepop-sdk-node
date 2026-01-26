import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'

function prepMockServer(server: MockServer, test_pop_id: string, test_pipeline_id: string) {
    const test_access_token = uuidv4()
    const token_valid_time = 1000 * 1000

    const authenticationRoute = server.post('/v1/auth/authenticate').mockImplementation(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({
            access_token: test_access_token,
            expires_in: token_valid_time,
            token_type: 'Bearer',
        })
    })

    const popConfigRoute = server.get(`/pops/${test_pop_id}/config`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id })
    })

    const getPipelineRoute = server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({
            id: test_pipeline_id,
        })
    })

    return { authenticationRoute, popConfigRoute, getPipelineRoute }
}

describe('EyePopSdk endpoint module upload', () => {
    const server = new MockServer()

    const test_api_key = uuidv4()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('EyePopSdk upload', async () => {
        const fake_timestamp = Date.now()
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const image_path = './tests/test.jpg'
        const { authenticationRoute, popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const uploadRoute = server.post(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            expect(ctx.headers['authorization']).toBeDefined()
            expect(ctx.request.query['mode']).toBe('queue')
            expect(ctx.request.query['processing']).toBe('sync')
            let bodyContent = await ctx.request.req.toArray()
            // post is gzip'ed and not sure how to use this KOA api to retrieve the decompressed content
            expect(bodyContent.length).toBeGreaterThan(0)
            expect(bodyContent.length).toBeLessThanOrEqual(fs.statSync(image_path).size)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: fake_timestamp })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: test_api_key },
            popId: test_pop_id,
            stopJobs: false,
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            let job = await endpoint.process({ path: image_path })
            expect(job).toBeDefined()
            let count = 0
            for await (let prediction of await job) {
                count++
                expect(prediction.timestamp).toBe(fake_timestamp)
            }
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(count).toBe(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk upload file not found', async () => {
        const fake_timestamp = Date.now()
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const image_path = './tests/does_not_exist.dummy'
        const { authenticationRoute, popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: test_api_key },
            popId: test_pop_id,
            stopJobs: false,
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            expect(endpoint.process({ path: image_path })).rejects.toBeDefined()
        } finally {
            await endpoint.disconnect()
        }
    })
})
