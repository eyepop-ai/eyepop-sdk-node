import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

function prepMockServer(server: MockServer, test_pop_id: string, test_pipeline_id: string) {
    const test_access_token = uuidv4()

    const authenticationRoute = server.post('/v1/auth/authenticate').mockImplementation(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ access_token: test_access_token, expires_in: 1000 * 1000, token_type: 'Bearer' })
    })

    const popConfigRoute = server.get(`/pops/${test_pop_id}/config`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id })
    })

    const getPipelineRoute = server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ id: test_pipeline_id })
    })

    return { authenticationRoute, popConfigRoute, getPipelineRoute }
}

describe('a source camera reaches the worker', () => {
    const server = new MockServer()
    const test_api_key = uuidv4()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('a calibration travels with a URL source', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const location = 'http://invalid.example'
        const { popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)
        const camera = {
            intrinsics: { fx: 0.9, fy: 1.6, cx: 0.5, cy: 0.5 },
            distortion: { k1: -0.2 },
            extrinsics: { rotation: { w: 0.7071, x: -0.7071, y: 0, z: 0 }, translation: { x: 0, y: 0, z: 5 } },
        }

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            // the whole calibration, not a flattened or partial one: the worker
            // resolves the field of view against the frame it is handed
            // @ts-ignore
            expect(ctx.request.body['camera']).toEqual(camera)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            const job = await endpoint.process({ source: { url: location }, camera })
            for await (const _ of job) {
                // drain
            }
            expect(loadFromRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a source without a camera sends none', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const { popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            // @ts-ignore
            expect(ctx.request.body['camera']).toBeUndefined()
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            const job = await endpoint.process({ source: { url: 'http://invalid.example' } })
            for await (const _ of job) {
                // drain
            }
            expect(loadFromRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a group upload validates its calibration too', async () => {
        // the group paths build their jobs directly rather than going through
        // process(), so they need the check of their own
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const { popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            await expect(endpoint.loadFromGroup(['http://invalid.example'], { camera: {} })).rejects.toThrow()
            expect(loadFromRoute).toHaveBeenCalledTimes(0)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('an unusable calibration fails before the upload starts', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const { popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const loadFromRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: Date.now() })
        })

        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false })
        try {
            await endpoint.connect()
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            // two descriptions of one lens, which the worker also rejects - but
            // as a 400 once the source is already in flight
            await expect(endpoint.process({ source: { url: 'http://invalid.example' }, camera: { intrinsics: { fx: 0.9, fy: 1.6, cx: 0.5, cy: 0.5 }, hfovDegrees: 72 } })).rejects.toThrow()
            expect(loadFromRoute).toHaveBeenCalledTimes(0)
        } finally {
            await endpoint.disconnect()
        }
    })
})
