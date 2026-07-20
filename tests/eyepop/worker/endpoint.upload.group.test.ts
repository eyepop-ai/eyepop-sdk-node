import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
async function readMultipartBody(ctx: any): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of ctx.req) {
        chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
}

function countMultipartParts(rawBody: string, name: string): number {
    return (rawBody.match(new RegExp(`name="${name}"`, 'g')) ?? []).length
}

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

describe('EyePopSdk endpoint module uploadGroup', () => {
    const server = new MockServer()
    const test_api_key = uuidv4()
    const image_path = './tests/test.jpg'

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('uploadGroup sends one multipart POST with N file parts', async () => {
        const fake_timestamp = Date.now()
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const { authenticationRoute, popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const uploadRoute = server.post(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            expect(ctx.headers['authorization']).toBeDefined()
            expect(ctx.request.query['mode']).toBe('queue')
            expect(ctx.request.query['processing']).toBe('sync')
            expect(ctx.headers['content-type']).toMatch(/multipart\/form-data/)
            const rawBody = await readMultipartBody(ctx)
            expect(countMultipartParts(rawBody, 'file')).toBe(2)
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

            const job = await endpoint.uploadGroup([image_path, image_path])
            expect(job).toBeDefined()
            let count = 0
            for await (const prediction of job) {
                count++
                expect(prediction.timestamp).toBe(fake_timestamp)
            }
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(count).toBe(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('uploadStreamGroup sends one multipart POST with mime types', async () => {
        const fake_timestamp = Date.now()
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const { authenticationRoute, popConfigRoute } = prepMockServer(server, test_pop_id, test_pipeline_id)

        const uploadRoute = server.post(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            expect(ctx.headers['authorization']).toBeDefined()
            expect(ctx.headers['content-type']).toMatch(/multipart\/form-data/)
            expect(ctx.request.query['motionDetect']).toBe('true')
            expect(ctx.request.query['motionSensitivity']).toBe('0.5')
            const rawBody = await readMultipartBody(ctx)
            expect(countMultipartParts(rawBody, 'file')).toBe(2)
            expect(countMultipartParts(rawBody, 'fps')).toBe(1)
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

            const blob1 = new Blob(['fake-image-data'])
            const blob2 = new Blob(['fake-image-data'])
            const job = await endpoint.uploadStreamGroup([blob1, blob2], ['image/jpeg', 'image/jpeg'], {
                fps: '1/2',
                motionDetect: {
                    motionDetect: true,
                    motionSensitivity: 0.5,
                },
            })
            expect(job).toBeDefined()
            let count = 0
            for await (const prediction of job) {
                count++
                expect(prediction.timestamp).toBe(fake_timestamp)
            }
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(count).toBe(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('uploadGroup rejects empty path array without connecting', async () => {
        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: test_api_key },
            popId: uuidv4(),
            stopJobs: false,
        })
        await expect(endpoint.uploadGroup([])).rejects.toThrow()
    })

    test('uploadStreamGroup rejects mismatched mimeTypes length', async () => {
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
            const blob = new Blob(['fake'])
            await expect(endpoint.uploadStreamGroup([blob, blob], ['image/jpeg'])).rejects.toThrow()
        } finally {
            await endpoint.disconnect()
        }
    })
})
