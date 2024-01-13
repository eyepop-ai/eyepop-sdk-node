import {MockServer} from 'jest-mock-server'

import {describe, expect, test} from '@jest/globals'
import {EyePopSdk} from '../src'
import {v4 as uuidv4} from 'uuid'

function prepMockServer(server: MockServer, test_pop_id: string, test_pipeline_id: string) {
    const test_access_token = uuidv4()
    const token_valid_time = 1000 * 1000

    const authenticationRoute = server
        .post('/authentication/token')
        .mockImplementation((ctx) => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                'access_token': test_access_token,
                'expires_in': token_valid_time,
                'token_type': 'Bearer'
            })
        })

    const popConfigRoute = server
        .get(`/pops/${test_pop_id}/config`)
        .mockImplementationOnce((ctx) => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id})
        })
    return {authenticationRoute, popConfigRoute};
}

describe('EyePopSdk endpoint module loadFrom', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('EyePopSdk loadFrom', async () => {
        const fake_timestamp = Date.now()
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const location = 'http://invalid.example'
        const {authenticationRoute, popConfigRoute} = prepMockServer(server, test_pop_id, test_pipeline_id)

        const uploadRoute = server
        .patch(`/worker/pipelines/${test_pipeline_id}/source`)
        .mockImplementation(async (ctx) => {
            expect(ctx.headers['authorization']).toBeDefined()
            expect(ctx.request.query['mode']).toBe('queue')
            expect(ctx.request.query['processing']).toBe('sync')
            expect(ctx.request.body).toBeDefined()
            // @ts-ignore
            expect(ctx.request.body['sourceType']).toBe('URL')
            // @ts-ignore
            expect(ctx.request.body['url']).toBe(location)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({timestamp: fake_timestamp})
        })

        const endpoint = EyePopSdk.endpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            let job = await endpoint.loadFrom(location)
            expect(job).toBeDefined()
            let count = 0
            for await (let prediction of await job.results()) {
                count++
                expect(prediction.timestamp).toBe(fake_timestamp)
            }
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(count).toBe(1)
        } finally {
            await endpoint.disconnect()
        }
    })
})