import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

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

    server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ id: test_pipeline_id })
    })

    return { authenticationRoute, popConfigRoute }
}

describe('EyePopSdk endpoint module loadFromGroup', () => {
    const server = new MockServer()
    const test_api_key = uuidv4()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('loadFromGroup sends PATCH with GROUP sourceType and ordered sources', async () => {
        const fake_timestamp = Date.now()
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const urls = ['http://example.com/a.jpg', 'http://example.com/b.jpg', 'http://example.com/c.jpg']
        const { authenticationRoute, popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            expect(ctx.headers['authorization']).toBeDefined()
            expect(ctx.request.query['mode']).toBe('queue')
            expect(ctx.request.query['processing']).toBe('sync')
            expect(ctx.request.body).toBeDefined()
            // @ts-ignore
            expect(ctx.request.body['sourceType']).toBe('GROUP')
            // @ts-ignore
            const sources = ctx.request.body['sources']
            expect(Array.isArray(sources)).toBe(true)
            expect(sources.length).toBe(3)
            sources.forEach((s: any, i: number) => {
                expect(s.sourceType).toBe('URL')
                expect(s.url).toBe(urls[i])
            })
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
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)

            const job = await endpoint.loadFromGroup(urls)
            expect(job).toBeDefined()
            let count = 0
            for await (const prediction of job) {
                count++
                expect(prediction.timestamp).toBe(fake_timestamp)
            }
            expect(loadFromRoute).toHaveBeenCalledTimes(1)
            expect(count).toBe(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('loadFromGroup rejects empty url array', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        prepMockServer(server, test_pop_id, test_pipeline_id)

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: test_api_key },
            popId: test_pop_id,
            stopJobs: false,
        })
        try {
            await endpoint.connect()
            await expect(endpoint.loadFromGroup([])).rejects.toThrow()
        } finally {
            await endpoint.disconnect()
        }
    })
})
