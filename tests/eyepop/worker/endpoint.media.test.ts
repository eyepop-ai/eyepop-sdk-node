import { EyePop, MediaReadError, MediaReads, PredictedObject, Prediction, PredictionFrameError, ResultStream, WorkerEndpoint } from '../../../src/eyepop'
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { MockServer } from 'jest-mock-server'
import { v4 as uuidv4 } from 'uuid'
import { pino } from 'pino'
import { FakePipelineApi, sources } from './pipeline_fake'

// Reading a recording by mediaId (eyepop-instance spec 025, AIW-187).

const ENV = [
    'EYEPOP_URL',
    'EYEPOP_API_KEY',
    'EYEPOP_POP_ID',
    'EYEPOP_SESSION_UUID',
    'EYEPOP_SESSION_NAME',
    'EYEPOP_PIPELINE_IMAGE',
    'EYEPOP_PIPELINE_VERSION',
    'EYEPOP_PIPELINE_MODE',
    'EYEPOP_LOCAL_MODE',
    'EYEPOP_ENV',
]

async function all(stream: ResultStream): Promise<Prediction[]> {
    const results: Prediction[] = []
    for await (const result of stream) {
        results.push(result)
    }
    return results
}

async function bytes(stream: ReadableStream<Uint8Array>): Promise<string> {
    return Buffer.from(await new Response(stream).arrayBuffer()).toString()
}

async function rejection<E>(read: Promise<unknown>, type: new (...args: any[]) => E): Promise<E> {
    try {
        await read
    } catch (error) {
        expect(error).toBeInstanceOf(type)
        return error as E
    }
    throw new Error('read without a refusal')
}

const refusal = (read: Promise<unknown>) => rejection(read, MediaReadError)

const PERSON: PredictedObject = { classLabel: 'person', confidence: 0.9, category: undefined as any, x: 10.4, y: 20.6, width: 100.2, height: 50, id: 1 } as PredictedObject
const PREDICTION: Prediction = { timestamp: 1500, source_width: 640, source_height: 480, objects: [PERSON] }

describe('reads by mediaId in pipeline mode (spec 025)', () => {
    let fake: FakePipelineApi
    let saved: Record<string, string | undefined>
    let ep: WorkerEndpoint

    beforeEach(async () => {
        saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]))
        ENV.forEach(name => delete process.env[name])
        fake = new FakePipelineApi()
        await fake.start()
        ep = EyePop.workerEndpoint({ eyepopUrl: fake.url, apiKey: 'the api key', isPipelineMode: true, logger: pino({ level: 'silent' }) })
        await ep.connect()
    })

    afterEach(async () => {
        await ep.disconnect()
        await fake.stop()
        ENV.forEach(name => (saved[name] === undefined ? delete process.env[name] : (process.env[name] = saved[name])))
    })

    test('range, frame and clip go to the pipeline API under the socket token', async () => {
        expect(await ep.mediaRange('v1.abc')).toEqual({ startNs: 1000, endNs: 9000 })
        const frame = await ep.mediaFrame('v1.abc', 1500, { bbox: { x: 1.5, y: 2, width: 10, height: 20.2 }, maxWidth: 160, maxHeight: 120, waitMs: 500 })
        expect(Buffer.from(frame).toString()).toBe('frame:1500')
        const png = await ep.mediaFrame('v1.abc', 1500, { png: true })
        expect(Buffer.from(png).toString()).toBe('frame:1500')
        const clip = await ep.mediaClip('v1.abc', 1000, 5000, { mode: 'keyframe', waitMs: 0 })
        expect(clip.startNs).toBe(1000)
        expect(clip.endNs).toBe(5000)
        expect(clip.milliComputeUnits).toBe(42)
        expect(await bytes(clip.stream)).toBe('clip:1000-5000')

        const [range, jpeg, pngRead, clipRead] = fake.mediaRequests
        expect(range?.path).toBe('/api/v1/media/v1.abc/range')
        expect(range?.authorization).toBe('Bearer minted-1')
        expect(jpeg?.path).toBe('/api/v1/media/v1.abc/frame')
        expect(Object.fromEntries(jpeg!.query)).toEqual({ timestamp: '1500', bbox: '1,2,11,21', maxWidth: '160', maxHeight: '120', wait: '500' })
        expect(jpeg?.accept).toBe('image/jpeg')
        expect(pngRead?.accept).toBe('image/png')
        expect(Object.fromEntries(clipRead!.query)).toEqual({ start: '1000', end: '5000', mode: 'keyframe', wait: '0' })
        expect(clipRead?.accept).toBe('video/mp4')
    })

    test('a bigint timestamp goes exactly, and a number past 2^53 is refused before any request', async () => {
        await ep.mediaFrame('v1.abc', 2n ** 60n)
        expect(fake.mediaRequests[0]?.query.get('timestamp')).toBe('1152921504606846976')
        await expect(ep.mediaFrame('v1.abc', 2 ** 60)).rejects.toThrow(RangeError)
        await expect(ep.mediaFrame('v1.abc', 1.5)).rejects.toThrow(RangeError)
        expect(fake.mediaRequests).toHaveLength(1)
    })

    test("a job's mediaFrame reads the prediction's timestamp and the object's box", async () => {
        const job = await ep.process({ source: { url: 'https://videos.example/a.mp4' }, mediaCacheSeconds: 600 })
        await all(job)
        const id = sources(fake.sockets[0]!)[0]!['id']
        expect(job.mediaId).toBe(`v1.media-of-${id}`)
        await job.mediaFrame(PREDICTION, PERSON, { maxWidth: 160 })
        // an object past the source's edge is clipped to it
        await job.mediaFrame(PREDICTION, { ...PERSON, x: 600, width: 100 })
        await job.mediaFrame(PREDICTION)
        const [cropped, clipped, whole] = fake.mediaRequests
        expect(cropped?.path).toBe(`/api/v1/media/${encodeURIComponent(job.mediaId!)}/frame`)
        expect(Object.fromEntries(cropped!.query)).toEqual({ timestamp: '1500', bbox: '10,20,101,51', maxWidth: '160' })
        expect(clipped?.query.get('bbox')).toBe('600,20,40,51')
        expect(whole?.query.has('bbox')).toBe(false)
    })

    test("a job's mediaFrame without a mediaId or a timestamp says so", async () => {
        const job = await ep.process({ source: { url: 'https://videos.example/a.mp4' } })
        await all(job)
        expect(job.mediaId).toBeUndefined()
        expect((await rejection(job.mediaFrame(PREDICTION, PERSON), PredictionFrameError)).reason).toBe('no_media_id')
        const recorded = await ep.process({ source: { url: 'https://videos.example/b.mp4' }, mediaCacheSeconds: 60 })
        await all(recorded)
        expect((await rejection(recorded.mediaFrame({ source_width: 640, source_height: 480 }), PredictionFrameError)).reason).toBe('no_timestamp')
        expect(fake.mediaRequests).toHaveLength(0)
    })

    test('a 425 is asked again after its Retry-After, within the deadline', async () => {
        const notYet = {
            status: 425,
            headers: { 'Retry-After': '0', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'media unavailable', reason: 'media_not_yet_available', message: 'not yet' }),
        }
        fake.mediaAnswers = [notYet, notYet]
        const frame = await ep.mediaFrame('v1.abc', 1500)
        expect(Buffer.from(frame).toString()).toBe('frame:1500')
        expect(fake.mediaRequests).toHaveLength(3)
    })

    test('a 425 past the deadline throws MediaReadError with the Retry-After', async () => {
        fake.mediaAnswers = [
            {
                status: 425,
                headers: { 'Retry-After': '1', 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'media unavailable', reason: 'media_not_yet_available', message: 'not yet' }),
            },
        ]
        const error = await refusal(ep.mediaClip('v1.abc', 0, 1000, { deadlineMs: 0 }))
        expect(error.status).toBe(425)
        expect(error.reason).toBe('media_not_yet_available')
        expect(error.retryAfterMs).toBe(1000)
        expect(fake.mediaRequests).toHaveLength(1)
    })

    test('deadlineMs 0 does not ask again, even after a Retry-After of 0', async () => {
        fake.mediaAnswers = [
            {
                status: 425,
                headers: { 'Retry-After': '0', 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'media unavailable', reason: 'media_not_yet_available', message: 'not yet' }),
            },
        ]
        const error = await refusal(ep.mediaFrame('v1.abc', 1500, { deadlineMs: 0 }))
        expect(error.status).toBe(425)
        expect(error.retryAfterMs).toBe(0)
        expect(fake.mediaRequests).toHaveLength(1)
    })

    test.each([
        ['error', { error: 'overloaded', message: 'max-reads' }],
        ['reason', { error: 'unavailable', reason: 'overloaded', message: 'max-reads' }],
    ])('a 503 overloaded (in %s) is asked again after its Retry-After, within the deadline', async (_field, body) => {
        const overloaded = { status: 503, headers: { 'Retry-After': '0', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        fake.mediaAnswers = [overloaded, overloaded]
        const frame = await ep.mediaFrame('v1.abc', 1500)
        expect(Buffer.from(frame).toString()).toBe('frame:1500')
        expect(fake.mediaRequests).toHaveLength(3)
    })

    test('a 503 overloaded past the deadline throws MediaReadError with the Retry-After', async () => {
        fake.mediaAnswers = [{ status: 503, headers: { 'Retry-After': '2', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'overloaded', message: 'max-reads' }) }]
        const error = await refusal(ep.mediaClip('v1.abc', 0, 1000, { deadlineMs: 500 }))
        expect(error.status).toBe(503)
        expect(error.error).toBe('overloaded')
        expect(error.retryAfterMs).toBe(2000)
        expect(fake.mediaRequests).toHaveLength(1)
    })

    test('a 401 authenticates again once', async () => {
        fake.mediaAnswers = [{ status: 401 }]
        expect(await ep.mediaRange('v1.abc')).toEqual({ startNs: 1000, endNs: 9000 })
        expect(fake.mediaRequests.map(r => r.authorization)).toEqual(['Bearer minted-1', 'Bearer minted-2'])
    })

    test.each([
        [400, 'invalid_media_id'],
        [400, 'clip_too_long'],
        [403, 'no_account'],
        [404, 'stream_not_found'],
        [410, 'media_expired'],
        [503, 'media_cache_not_configured'],
    ])('%d %s throws MediaReadError with the server fields', async (status, reason) => {
        fake.mediaAnswers = [{ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'refused', reason, message: `the ${reason}` }) }]
        const error = await refusal(ep.mediaClip('v1.abc', 0, 1000))
        expect(error.status).toBe(status)
        expect(error.error).toBe('refused')
        expect(error.reason).toBe(reason)
        expect(error.serverMessage).toBe(`the ${reason}`)
        expect(fake.mediaRequests).toHaveLength(1)
    })

    test('a refusal without JSON keeps its text', async () => {
        fake.mediaAnswers = [{ status: 502, body: 'bad gateway' }]
        const error = await refusal(ep.mediaRange('v1.abc'))
        expect(error.status).toBe(502)
        expect(error.reason).toBeUndefined()
        expect(error.serverMessage).toBe('bad gateway')
    })
})

describe('reads by mediaId on a worker session (spec 025)', () => {
    let server: MockServer
    const mediaId = 'v2.AAAAAAAAAAAAAAAAAAAAAA.abc'

    beforeEach(async () => {
        server = new MockServer()
        await server.start()
    })
    afterEach(async () => {
        await server.stop()
    })

    function session(popId: string, pipelineId: string, token: string) {
        server.post('/v1/auth/authenticate').mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ access_token: token, expires_in: 1000 * 1000, token_type: 'Bearer' })
        })
        server.get(`/pops/${popId}/config`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/`, pipeline_id: pipelineId })
        })
        server.get(`/worker/pipelines/${pipelineId}`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ id: pipelineId })
        })
    }

    test('the recording event sets mediaId, a warning is kept and logged, and reads go to the instance', async () => {
        const popId = uuidv4()
        const pipelineId = uuidv4()
        const token = uuidv4()
        session(popId, pipelineId, token)
        const gap = { code: 'media_cache_gop_too_long', level: 'warn', gap_ms: 12000, threshold_ms: 10000 }
        server.patch(`/worker/pipelines/${pipelineId}/source`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/jsonl'
            ctx.body = [
                JSON.stringify({ event: { type: 'recording', mediaId } }),
                JSON.stringify({ event: 'warning', source_id: 's1', message: 'the source went 12.0 s without a keyframe', info: gap }),
                JSON.stringify(PREDICTION),
                '',
            ].join('\n')
        })
        const reads: Array<{ path: string; query: Record<string, unknown>; authorization: string | undefined; accept: string | undefined }> = []
        const note = (ctx: any) => reads.push({ path: ctx.path, query: { ...ctx.request.query }, authorization: ctx.request.headers['authorization'], accept: ctx.request.headers['accept'] })
        server.get(`/worker/media/${mediaId}/range`).mockImplementation(ctx => {
            note(ctx)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ start_ns: 100, end_ns: 2000 })
        })
        let notYet = 1
        server.get(`/worker/media/${mediaId}/frame`).mockImplementation(ctx => {
            note(ctx)
            if (notYet-- > 0) {
                ctx.status = 425
                ctx.set('Retry-After', '0')
                ctx.body = { error: 'media unavailable', reason: 'media_not_yet_available', message: 'not yet' }
                return
            }
            ctx.status = 200
            ctx.response.headers['content-type'] = 'image/jpeg'
            ctx.body = Buffer.from('jpeg')
        })
        server.get(`/worker/media/${mediaId}/clip`).mockImplementation(ctx => {
            note(ctx)
            ctx.status = 200
            ctx.set('X-Start-Ns', '90')
            ctx.set('X-End-Ns', '1990')
            ctx.response.headers['content-type'] = 'video/mp4'
            ctx.body = Buffer.from('mp4')
        })
        const logged: string[] = []
        const logger = pino({ level: 'warn' }, { write: (line: string) => logged.push(JSON.parse(line).msg) })
        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: uuidv4() }, popId, stopJobs: false, isPipelineMode: false, logger })
        try {
            await endpoint.connect()
            const job = await endpoint.process({ source: { url: 'rtsp://camera.example/1' }, mediaCacheSeconds: 3600 })
            const predictions = await all(job)
            expect(predictions).toHaveLength(1)
            expect(job.mediaId).toBe(mediaId)
            expect(job.warnings).toEqual([{ message: 'the source went 12.0 s without a keyframe', info: gap }])
            expect(logged.some(line => line.includes('12.0 s without a keyframe'))).toBe(true)

            expect(await endpoint.mediaRange(mediaId)).toEqual({ startNs: 100, endNs: 2000 })
            const frame = await job.mediaFrame(predictions[0]!, PERSON, { maxHeight: 64 })
            expect(Buffer.from(frame).toString()).toBe('jpeg')
            const clip = await endpoint.mediaClip(mediaId, 100, 2000)
            expect(clip.startNs).toBe(90)
            expect(clip.endNs).toBe(1990)
            expect(clip.milliComputeUnits).toBeUndefined()
            expect(await bytes(clip.stream)).toBe('mp4')
        } finally {
            await endpoint.disconnect()
        }
        expect(reads.map(r => r.path)).toEqual([`/worker/media/${mediaId}/range`, `/worker/media/${mediaId}/frame`, `/worker/media/${mediaId}/frame`, `/worker/media/${mediaId}/clip`])
        expect(reads.every(r => r.authorization === `Bearer ${token}`)).toBe(true)
        expect(reads[2]?.query).toEqual({ timestamp: '1500', bbox: '10,20,101,51', maxHeight: '64' })
        expect(reads[2]?.accept).toBe('image/jpeg')
        expect(reads[3]?.query).toEqual({ start: '100', end: '2000' })
    })

    test('a 404 is a MediaReadError and does not reconnect the session', async () => {
        const popId = uuidv4()
        const pipelineId = uuidv4()
        session(popId, pipelineId, uuidv4())
        const range = server.get(`/worker/media/${mediaId}/range`).mockImplementation(ctx => {
            ctx.status = 404
            ctx.body = { error: 'recording not found', reason: 'stream_not_found', message: 'no recording' }
        })
        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: uuidv4() }, popId, stopJobs: false, isPipelineMode: false, logger: pino({ level: 'silent' }) })
        try {
            await endpoint.connect()
            const error = await refusal(endpoint.mediaRange(mediaId))
            expect(error.status).toBe(404)
            expect(error.reason).toBe('stream_not_found')
            // the pop's config was asked once, at connect: the 404 did not drop the session
            expect(await endpoint.mediaRange(mediaId).catch((e: unknown) => e)).toBeInstanceOf(MediaReadError)
        } finally {
            await endpoint.disconnect()
        }
        expect(range).toHaveBeenCalledTimes(2)
    })

    test('an upload job keeps the recording event after prepared', async () => {
        const popId = uuidv4()
        const pipelineId = uuidv4()
        session(popId, pipelineId, uuidv4())
        server.post(`/worker/pipelines/${pipelineId}/source`).mockImplementation(async ctx => {
            await ctx.request.req.toArray()
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/jsonl'
            ctx.body = [JSON.stringify({ event: { type: 'recording', mediaId } }), JSON.stringify(PREDICTION), ''].join('\n')
        })
        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: uuidv4() }, popId, stopJobs: false, isPipelineMode: false, logger: pino({ level: 'silent' }) })
        try {
            await endpoint.connect()
            const job = await endpoint.process({ source: { path: './tests/test.jpg' }, mediaCacheSeconds: 60 })
            expect(await all(job)).toHaveLength(1)
            expect(job.mediaId).toBe(mediaId)
        } finally {
            await endpoint.disconnect()
        }
    })

    test("a 401 on a compute session's read resolves the session again for a fresh session token", async () => {
        const sessionUuid = uuidv4()
        const pipelineId = uuidv4()
        const tokens = ['session-token-1', 'session-token-2']
        let resolved = 0
        server.post('/v1/auth/authenticate').mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ access_token: uuidv4(), expires_in: 1000 * 1000, token_type: 'Bearer' })
        })
        server.get(`/v1/sessions/${sessionUuid}`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                session_uuid: sessionUuid,
                session_endpoint: `${server.getURL().toString()}${sessionUuid}`,
                access_token: tokens[Math.min(resolved++, tokens.length - 1)],
                access_token_expires_in: 1000 * 1000,
                pipeline_uuid: '',
                pipelines: [{ pipeline_id: pipelineId }],
                session_status: 'running',
                session_active: true,
                persistent: true,
            })
        })
        server.get(`/${sessionUuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })
        const authorizations: Array<string | undefined> = []
        server.get(`/${sessionUuid}/media/${mediaId}/range`).mockImplementation(ctx => {
            const authorization = ctx.request.headers['authorization']
            authorizations.push(authorization)
            if (authorization !== `Bearer ${tokens[1]}`) {
                ctx.status = 401
                return
            }
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ start_ns: 100, end_ns: 2000 })
        })
        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: uuidv4() },
            sessionUuid,
            stopJobs: false,
            isPipelineMode: false,
            logger: pino({ level: 'silent' }),
        })
        try {
            await endpoint.connect()
            expect(await endpoint.mediaRange(mediaId)).toEqual({ startNs: 100, endNs: 2000 })
        } finally {
            await endpoint.disconnect()
        }
        expect(authorizations).toEqual([`Bearer ${tokens[0]}`, `Bearer ${tokens[1]}`])
    })
})

describe('a refusal whose body cannot be read', () => {
    test('throws MediaReadError with the status and the read failure as its cause', async () => {
        const broken = new Error('connection reset')
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.error(broken)
            },
        })
        const reads = new MediaReads({
            client: () => ({ fetch: async () => new Response(body, { status: 500 }) }) as any,
            route: () => ({ mediaBaseUrl: async () => 'http://media.example', mediaHeaders: async () => ({}), refreshMediaCredential: async () => undefined }),
            requestLogger: pino({ level: 'silent' }),
        })
        const error = await refusal(reads.mediaRange('v1.abc'))
        expect(error.status).toBe(500)
        expect(error.reason).toBeUndefined()
        expect(error.cause).toBe(broken)
    })
})
