import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

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

/**
 * The worker builds RFC 2326 compliant SETUP URLs by default, which is what a
 * camera advertising an absolute control URL needs. The option is for the
 * servers that require the older construction, so an unset value must stay off
 * the wire rather than travel as false: the worker's default should decide.
 */
describe('the RTSP URL compliance option reaches the worker', () => {
    const server = new MockServer()
    const test_api_key = uuidv4()
    const location = 'rtsp://camera.invalid/axis-media/media.amp'

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    async function runWithParams(params: object, assertBody: (body: any) => void) {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            // @ts-ignore
            assertBody(ctx.request.body)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: test_api_key },
            popId: test_pop_id,
            stopJobs: false,
        })
        try {
            await endpoint.connect()
            const job = await endpoint.process({ source: { url: location }, ...params })
            for await (const _ of job) {
                // drain
            }
            expect(loadFromRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    }

    test('an unset option is not sent at all', async () => {
        await runWithParams({}, body => {
            expect(body).not.toHaveProperty('rtspForceNonCompliantUrl')
        })
    })

    test('a requested option travels with the source', async () => {
        await runWithParams({ rtspForceNonCompliantUrl: true }, body => {
            expect(body['rtspForceNonCompliantUrl']).toBe(true)
        })
    })

    test('an explicit false is sent rather than dropped', async () => {
        // Not the same as unset: it pins the compliant construction against a
        // worker whose own default might differ.
        await runWithParams({ rtspForceNonCompliantUrl: false }, body => {
            expect(body['rtspForceNonCompliantUrl']).toBe(false)
        })
    })
})
