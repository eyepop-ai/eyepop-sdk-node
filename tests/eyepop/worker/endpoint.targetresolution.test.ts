import { EyePop, VideoMode } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import { PassThrough } from 'stream'

/** A source that sends its first chunk and stays open until the test closes it. */
function openSource(firstChunk: Uint8Array): { stream: ReadableStream<Uint8Array>; close: () => void } {
    let close = () => {}
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(firstChunk)
            close = () => controller.close()
        },
    })
    return { stream, close: () => close() }
}

/** Resolves once the upload request reaches the server; fails if it has not within a few seconds. */
function uploadStarted(): { started: Promise<void>; signal: () => void } {
    let signal = () => {}
    const started = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the upload did not start while its source was still open')), 5000)
        signal = () => {
            clearTimeout(timer)
            resolve()
        }
    })
    return { started, signal }
}

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
    // each test gets its own server, so no route or pending request leaks between them
    let server: MockServer
    const test_api_key = uuidv4()

    beforeEach(async () => {
        server = new MockServer()
        await server.start()
    })
    afterEach(async () => {
        await server.stop()
    })

    // these tests cover worker session mode; pipeline mode is the default
    const workerEndpoint = (test_pop_id: string) =>
        EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: test_api_key }, popId: test_pop_id, stopJobs: false, isPipelineMode: false })

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

        const endpoint = workerEndpoint(test_pop_id)
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

        const endpoint = workerEndpoint(test_pop_id)
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

        const endpoint = workerEndpoint(test_pop_id)
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

    test('an image upload with a target resolution streams its file part', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        prepMockServer(server, test_pop_id, test_pipeline_id)
        const targetResolution = { width: 640, height: 480 }
        const { started, signal } = uploadStarted()
        let body = ''

        const uploadRoute = server.post(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            signal()
            expect(ctx.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
            body = Buffer.concat(await ctx.request.req.toArray()).toString('latin1')
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/jsonl'
            ctx.body = JSON.stringify({ timestamp: Date.now() }) + '\n'
        })

        const endpoint = workerEndpoint(test_pop_id)
        try {
            await endpoint.connect()
            const source = openSource(new Uint8Array([0xff, 0xd8, 0xff]))
            const job = endpoint.process({ source: { stream: source.stream, mimeType: 'image/jpeg' }, targetResolution })
            // results are read while the source is still open, as a caller does
            const drained = (async () => {
                for await (const _ of await job) {
                    // drain
                }
            })()
            await started
            source.close()
            await drained
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(body).toContain('name="targetResolution"')
            expect(body).toContain(JSON.stringify(targetResolution))
            expect(body).toContain('name="file"; filename="blob"')
            expect(body).toContain('\xff\xd8\xff')
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a streamed video with a target resolution streams its async upload', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const prepared_source_id = uuidv4()
        prepMockServer(server, test_pop_id, test_pipeline_id)
        const targetResolution = { width: 1280, height: 720 }
        const { started, signal } = uploadStarted()
        let body = ''
        const resultStream = new PassThrough()

        server.post(`/worker/pipelines/${test_pipeline_id}/prepareSource`).mockImplementation(ctx => {
            // stays open as a real prepared result stream does until its source ends
            resultStream.write(JSON.stringify({ event: { type: 'prepared', source_id: prepared_source_id } }) + '\n')
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/jsonl'
            ctx.body = resultStream
        })
        const uploadRoute = server.post(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            signal()
            expect(ctx.request.query['sourceId']).toBe(prepared_source_id)
            expect(ctx.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
            body = Buffer.concat(await ctx.request.req.toArray()).toString('latin1')
            ctx.status = 204
            resultStream.end(JSON.stringify({ timestamp: Date.now() }) + '\n')
        })

        const endpoint = workerEndpoint(test_pop_id)
        try {
            await endpoint.connect()
            const source = openSource(new Uint8Array([0, 0, 0, 24]))
            const job = endpoint.process({ source: { stream: source.stream, mimeType: 'video/mp4', videoMode: VideoMode.STREAM }, targetResolution })
            // results are read while the source is still open, as a caller does
            const drained = (async () => {
                for await (const _ of await job) {
                    // drain
                }
            })()
            await started
            source.close()
            await drained
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(body).toContain('name="targetResolution"')
            expect(body).toContain(JSON.stringify(targetResolution))
            expect(body).toContain('name="file"; filename="blob"')
        } finally {
            await endpoint.disconnect()
        }
    })
})
