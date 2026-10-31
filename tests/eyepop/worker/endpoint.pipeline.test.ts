import {
    EyePop,
    PIPELINE_SOCKETS,
    PipelineBackend,
    PipelineCommandError,
    PipelineConfigurationError,
    PipelineSocketClosedError,
    PipelineSourceError,
    Pop,
    Prediction,
    ResultStream,
    SessionBackend,
    WorkerEndpoint,
} from '../../../src/eyepop'
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pino } from 'pino'
import { FakePipelineApi, FakeSocket, pops, prediction, sources } from './pipeline_fake'

const PERSON: Pop = { components: [{ type: 'inference', ability: 'eyepop.person:latest' } as any] }
const VEHICLE: Pop = { components: [{ type: 'inference', ability: 'eyepop.vehicle:latest' } as any] }

const ENV = ['EYEPOP_URL', 'EYEPOP_API_KEY', 'EYEPOP_POP_ID', 'EYEPOP_SESSION_UUID', 'EYEPOP_PIPELINE_MODE', 'EYEPOP_LOCAL_MODE']

async function all(stream: ResultStream): Promise<Prediction[]> {
    const results: Prediction[] = []
    for await (const result of stream) {
        results.push(result)
    }
    return results
}

function refusal(construct: () => unknown): unknown {
    try {
        construct()
    } catch (error) {
        return error
    }
    throw new Error('constructed without a refusal')
}

async function eventually(check: () => boolean, ms: number = 2000): Promise<void> {
    const deadline = Date.now() + ms
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error('condition not met in time')
        }
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

describe('pipeline mode (SDK-27)', () => {
    let fake: FakePipelineApi
    let saved: Record<string, string | undefined>
    let warnings: string[]
    let tmp: string

    beforeEach(async () => {
        saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]))
        ENV.forEach(name => delete process.env[name])
        fake = new FakePipelineApi()
        await fake.start()
        warnings = []
        tmp = mkdtempSync(join(tmpdir(), 'pipeline-mode-'))
    })

    afterEach(async () => {
        await fake.stop()
        ENV.forEach(name => (saved[name] === undefined ? delete process.env[name] : (process.env[name] = saved[name])))
    })

    const inPipelineMode = (endpoint: unknown): boolean => endpoint instanceof WorkerEndpoint && endpoint.backend() instanceof PipelineBackend

    function endpoint(options: Record<string, any> = {}): WorkerEndpoint {
        const logger = pino({ level: 'warn' }, { write: (line: string) => warnings.push(JSON.parse(line).msg) })
        const created = EyePop.workerEndpoint({ eyepopUrl: fake.url, apiKey: 'the api key', isPipelineMode: true, logger, ...options })
        expect(inPipelineMode(created)).toBe(true)
        return created
    }

    function file(name: string, content: string): string {
        const path = join(tmp, name)
        writeFileSync(path, content)
        return path
    }

    const only = (): FakeSocket => fake.sockets[0] as FakeSocket

    // 1. Selection

    test('is selected by the option or the environment', () => {
        expect(inPipelineMode(EyePop.workerEndpoint({ accessToken: 't', isPipelineMode: true }))).toBe(true)
        process.env['EYEPOP_PIPELINE_MODE'] = 'true'
        expect(inPipelineMode(EyePop.workerEndpoint({ accessToken: 't' }))).toBe(true)
        const session = EyePop.workerEndpoint({ accessToken: 't', isPipelineMode: false })
        expect(inPipelineMode(session)).toBe(false)
        expect(session.backend()).toBeInstanceOf(SessionBackend)
    })

    test.each([{ popId: 'a-named-pop' }, { sessionUuid: 'a-session' }, { sessionName: 'a-name' }, { pipelineImage: 'an-image' }, { pipelineVersion: '4.8.0' }, { jobQueueLength: 257 }])(
        'refuses %p, which only a worker session has',
        option => {
            expect(() => EyePop.workerEndpoint({ apiKey: 'k', isPipelineMode: true, ...option })).toThrow(PipelineConfigurationError)
        },
    )

    test.each([0, -1, 1.5])('refuses pipelineSockets %p', pipelineSockets => {
        expect(() => EyePop.workerEndpoint({ apiKey: 'k', isPipelineMode: true, pipelineSockets })).toThrow(PipelineConfigurationError)
    })

    test('a pipeline mode endpoint built directly holds 256 jobs and leaves the options as they were', () => {
        const options = { eyepopUrl: fake.url, accessToken: 't', isPipelineMode: true }
        const direct = new WorkerEndpoint(options)
        expect(direct.pendingJobs()).toBe(0)
        expect((direct as any)._limit.getPermits()).toBe(256)
        expect(options).toEqual({ eyepopUrl: fake.url, accessToken: 't', isPipelineMode: true })
    })

    test('refuses a session named by the environment', () => {
        process.env['EYEPOP_SESSION_UUID'] = 'a-session'
        expect(refusal(() => EyePop.workerEndpoint({ apiKey: 'k', isPipelineMode: true }))).toMatchObject({ problem: 'session_options', options: ['sessionUuid'] })
    })

    test('takes the pipeline API url from the compute API configs', async () => {
        const ep = endpoint()
        await ep.connect()
        expect((await ep.session()).baseUrl).toBe(fake.url)
        await ep.disconnect()
        expect(fake.sockets).toHaveLength(1)
        expect(fake.configAuthorizations).toEqual(['Bearer minted-1'])
    })

    test('a compute API without a pipeline API fails the connect naming the key', async () => {
        fake.pipelineApiUrl = null
        await expect(endpoint().connect()).rejects.toMatchObject({ problem: 'no_pipeline_api_url' })
    })

    test('plain http to a pipeline API off loopback is refused', async () => {
        fake.pipelineApiUrl = 'http://pipeline.example'
        await expect(endpoint().connect()).rejects.toMatchObject({ problem: 'insecure_url' })
    })

    test('local mode takes eyepopUrl as the pipeline API and sends no credential', async () => {
        const ep = EyePop.workerEndpoint({ eyepopUrl: fake.url, isPipelineMode: true, isLocalMode: true })
        await ep.connect()
        expect(await all(await ep.process({ source: { url: 'https://images.example/a.jpg' } }))).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
        expect(only().authorization).toBeUndefined()
        expect(only().protocols).toEqual(['eyepop.v1'])
    })

    // 2. Options not sent yet

    test('an option not sent warns once per endpoint naming AWSU-317', async () => {
        const ep = endpoint()
        await ep.connect()
        for (let i = 0; i < 2; i++) {
            await all(await ep.process({ source: { url: 'https://images.example/a.jpg' }, motionDetect: { everyNFrames: 1 } as any }))
        }
        await ep.disconnect()
        expect(warnings.filter(w => w.includes('motionDetect'))).toEqual(['motionDetect is not sent to the pipeline API and has no effect in pipeline mode (AWSU-317)'])
        expect(sources(only()).every(s => s['everyNFrames'] === undefined)).toBe(true)
    })

    // 3. Session-era methods and the pop

    test('connect opens the socket with the bearer token and sets the pop', async () => {
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        await ep.disconnect()
        expect(only().protocols).toEqual(['eyepop.v1'])
        expect(only().authorization).toBe('Bearer minted-1')
        expect(pops(only())).toEqual([PERSON])
        expect(fake.exchanges).toEqual(['Bearer the api key'])
    })

    test('changePop sets the pop, and a refused pop rejects and keeps the last one', async () => {
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        await ep.changePop(VEHICLE)
        expect(ep.pop()).toEqual(VEHICLE)
        fake.popError = 'invalid_request'
        await expect(ep.changePop(PERSON)).rejects.toMatchObject({ error: 'invalid_request' })
        expect(ep.pop()).toEqual(VEHICLE)
        await ep.disconnect()
    })

    // 4. Lifecycle

    test('after an idle close the next job reconnects and sets the pop again', async () => {
        fake.idleAfterDone = true
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        await all(await ep.process({ source: { url: 'https://images.example/a.jpg' } }))
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(await all(await ep.process({ source: { url: 'https://images.example/b.jpg' } }))).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
        expect(fake.sockets).toHaveLength(2)
        expect(pops(fake.sockets[1] as FakeSocket)).toEqual([PERSON])
    })

    test('credential_expired reconnects at once with a new token', async () => {
        fake.closes.set(1, [1008, 'credential_expired'])
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        await expect(all(await ep.process({ source: { url: 'https://images.example/a.jpg' } }))).rejects.toThrow(PipelineSocketClosedError)
        await eventually(() => fake.sockets.length === 2 && pops(fake.sockets[1] as FakeSocket).length === 1)
        expect(fake.sockets.map(s => s.authorization)).toEqual(['Bearer minted-1', 'Bearer minted-2'])
        expect(sources(fake.sockets[1] as FakeSocket)).toEqual([])
        await ep.disconnect()
    })

    test('a job in flight when the pipeline stops fails with the close and is not sent again', async () => {
        fake.closes.set(1, [1011, 'pipeline_stopped'])
        const ep = endpoint()
        await ep.connect()
        const failed = await all(await ep.process({ source: { url: 'https://images.example/a.jpg' } })).catch(e => e)
        expect(failed).toBeInstanceOf(PipelineSocketClosedError)
        expect([failed.code, failed.reason]).toEqual([1011, 'pipeline_stopped'])
        expect(await all(await ep.process({ source: { url: 'https://images.example/b.jpg' } }))).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
        expect(sources(fake.sockets[1] as FakeSocket).map(s => s['url'])).toEqual(['https://images.example/b.jpg'])
    })

    test('the upgrade waits through 503 with Retry-After', async () => {
        fake.upgradeAnswers.push({ status: 503, headers: { 'Retry-After': '0' } })
        const ep = endpoint()
        await ep.connect()
        await ep.disconnect()
        expect(fake.sockets).toHaveLength(1)
    })

    test('a 401 on the upgrade authenticates again', async () => {
        fake.upgradeAnswers.push({ status: 401 })
        const ep = endpoint()
        await ep.connect()
        await ep.disconnect()
        expect(only().authorization).toBe('Bearer minted-2')
    })

    test('a live source refused overloaded goes once more on a new socket, and twice raises', async () => {
        fake.overloadedLive = 1
        const ep = endpoint()
        await ep.connect()
        const live = await ep.process({ source: { url: 'rtsp://camera.example/stream' } })
        const iterator = live[Symbol.asyncIterator]()
        expect((await iterator.next()).value).toEqual(prediction(0))
        live.cancel()
        expect(fake.sockets).toHaveLength(2)

        fake.overloadedLive = 2
        await expect(all(await ep.process({ source: { url: 'rtsp://camera.example/other' } }))).rejects.toThrow(PipelineCommandError)
        await ep.disconnect()
    })

    test('closes one after another wait longer before each reconnect', async () => {
        // Every socket is closed 1001 shutting_down as it opens: the first reconnect is at once, the
        // next waits a second, the one after two
        fake.closeOnOpen = [1001, 'shutting_down']
        const ep = endpoint()
        await ep.connect()
        await new Promise(resolve => setTimeout(resolve, 500))
        expect(fake.sockets).toHaveLength(2)
        await new Promise(resolve => setTimeout(resolve, 1000))
        expect(fake.sockets).toHaveLength(3)
        await new Promise(resolve => setTimeout(resolve, 1000))
        expect(fake.sockets).toHaveLength(3)
        await ep.disconnect()
    })

    test('a job cancelled before its turn never sends its setSource', async () => {
        const ep = endpoint()
        await ep.connect()
        // the setPop holds the line until it is answered; the job submitted after it waits its turn
        fake.popDelayMs = 200
        const changing = ep.changePop(PERSON)
        const job = await ep.process({ source: { url: 'https://images.example/never.jpg' } })
        job.cancel()
        await changing
        expect(await all(job)).toEqual([])
        await ep.disconnect()
        expect(sources(only())).toEqual([])
    })

    test('a cancelled live job stops its source on the pipeline, and the next job plays', async () => {
        const ep = endpoint()
        await ep.connect()
        const live = await ep.process({ source: { url: 'rtsp://camera.example/stream' } })
        expect((await live[Symbol.asyncIterator]().next()).value).toEqual(prediction(0))
        live.cancel()
        // the live source no longer holds the pipeline's queue
        expect(await all(await ep.process({ source: { url: 'https://images.example/a.jpg' } }))).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
        expect(only().commands).toContainEqual({ type: 'stopSource', id: sources(only())[0]?.['id'] })
    })

    test('cancelling against a pipeline API without stopSource still ends the job', async () => {
        fake.knowsStopSource = false
        const ep = endpoint()
        await ep.connect()
        const live = await ep.process({ source: { url: 'rtsp://camera.example/stream' } })
        const iterator = live[Symbol.asyncIterator]()
        expect((await iterator.next()).value).toEqual(prediction(0))
        live.cancel()
        expect((await iterator.next()).done).toBe(true)
        await ep.disconnect()
    })

    test('a source that ends with an error rejects', async () => {
        const ep = endpoint()
        await ep.connect()
        await expect(all(await ep.process({ source: { url: 'https://images.example/bad.jpg' } }))).rejects.toThrow(PipelineSourceError)
        await ep.disconnect()
    })

    // 5. Uploads

    test('a small file goes combined', async () => {
        const ep = endpoint()
        await ep.connect()
        expect(await all(await ep.process({ source: { path: file('image.jpg', 'jpeg bytes') } }))).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
        const [source] = sources(only()) as [Record<string, any>]
        expect(source['upload']).toEqual({ contentType: 'image/jpeg' })
        expect(only().combined).toEqual([source['id']])
        expect(only().media.get(source['id'])?.get(null)?.toString()).toBe('jpeg bytes')
    })

    test('a stream of unknown size goes in chunks within the credit', async () => {
        fake.window = 3
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('video '))
                controller.enqueue(new TextEncoder().encode('bytes'))
                controller.close()
            },
        })
        const ep = endpoint()
        await ep.connect()
        await all(await ep.process({ source: { stream, mimeType: 'video/mp4' } }))
        await ep.disconnect()
        const [source] = sources(only()) as [Record<string, any>]
        expect(only().combined).toEqual([])
        expect(only().media.get(source['id'])?.get(null)?.toString()).toBe('video bytes')
        expect(only().commands).toContainEqual({ type: 'uploaded', id: source['id'] })
    })

    test('a group of files goes combined with each member’s bytes', async () => {
        const ep = endpoint()
        await ep.connect()
        await all(await ep.uploadGroup([file('a.png', 'one'), file('b.jpg', 'two2')]))
        await ep.disconnect()
        const [source] = sources(only()) as [Record<string, any>]
        expect(source['group']).toEqual([{ upload: { contentType: 'image/png', bytes: 3 } }, { upload: { contentType: 'image/jpeg', bytes: 4 } }])
        expect(only().media.get(source['id'])?.get(1)?.toString()).toBe('two2')
    })

    test('a group of streams uploads each member in chunks', async () => {
        const streamOf = (text: string) =>
            new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(text))
                    controller.close()
                },
            })
        const ep = endpoint()
        await ep.connect()
        await all(await ep.uploadStreamGroup([streamOf('first'), streamOf('second')], ['image/png', 'image/jpeg']))
        await ep.disconnect()
        const [source] = sources(only()) as [Record<string, any>]
        expect(source['group']).toEqual([{ upload: { contentType: 'image/png' } }, { upload: { contentType: 'image/jpeg' } }])
        expect(only().media.get(source['id'])?.get(0)?.toString()).toBe('first')
        expect(only().commands).toContainEqual({ type: 'uploaded', id: source['id'], member: 1 })
    })

    test('loadFromGroup and an asset name their source; no version or mode is sent', async () => {
        const ep = endpoint()
        await ep.connect()
        await all(await ep.loadFromGroup(['https://images.example/a.jpg', 'https://images.example/b.jpg']))
        await all(await ep.process({ source: { assetUuid: 'an-asset' } }))
        await ep.disconnect()
        const [group, asset] = sources(only()) as [Record<string, any>, Record<string, any>]
        expect(group['group']).toEqual([{ url: 'https://images.example/a.jpg' }, { url: 'https://images.example/b.jpg' }])
        expect(asset['assetUuid']).toBe('an-asset')
        expect(group['mode']).toBeUndefined()
        expect(group['version']).toBeUndefined()
    })

    // 6. Concurrency

    test('jobs go out in submission order on one socket', async () => {
        const urls = [0, 1, 2, 3, 4].map(n => `https://images.example/${n}.jpg`)
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const jobs = [await ep.process({ source: { path: file('image.jpg', 'jpeg') } })]
        for (const url of urls) {
            jobs.push(await ep.process({ source: { url } }))
        }
        const results = await Promise.all(jobs.map(all))
        await ep.disconnect()
        expect(results.every(r => r.length === 2)).toBe(true)
        expect(fake.sockets).toHaveLength(1)
        expect(sources(only()).map(s => s['url'])).toEqual([undefined, ...urls])
    })

    test('queue_full with no other source open rejects', async () => {
        fake.refusals.push('queue_full')
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const refused = await all(await ep.process({ source: { url: 'https://images.example/a.jpg' } })).catch(e => e)
        expect(refused).toBeInstanceOf(PipelineCommandError)
        expect(refused.error).toBe('queue_full')
        await ep.disconnect()
    })

    test('a source refused queue_full goes again once another ended', async () => {
        fake.queueFullAt = 2
        fake.sourceDelayMs = 20
        const urls = Array.from({ length: 30 }, (_, n) => `https://images.example/${n}.jpg`)
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const jobs = []
        for (const url of urls) {
            jobs.push(await ep.process({ source: { url } }))
        }
        const results = await Promise.all(jobs.map(all))
        await ep.disconnect()
        expect(results.every(r => r.length === 2)).toBe(true)
        expect(fake.queueFullRefused).toBeGreaterThan(0)
        // While the socket is full each end lets one send go, so no source is refused twice.
        expect(fake.queueFullRefused).toBeLessThanOrEqual(urls.length)
        expect(fake.sockets).toHaveLength(1)
        const sent = sources(only()).map(s => s['url'])
        expect([...new Set(sent)].sort()).toEqual([...urls].sort())
        expect(sent).toHaveLength(urls.length + fake.queueFullRefused)
    })

    test('the end of a cancelled source lets a source refused queue_full go', async () => {
        fake.queueFullAt = 1
        fake.sourceDelayMs = 300
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const slow = await ep.process({ source: { url: 'https://images.example/slow.jpg' } })
        const image = await ep.process({ source: { url: 'https://images.example/a.jpg' } })
        await eventually(() => fake.queueFullRefused === 1)
        slow.cancel()
        expect(await all(image)).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
    })

    test('a job cancelled while it waits for room ends at once', async () => {
        fake.queueFullAt = 1
        fake.sourceDelayMs = 300
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const slow = await ep.process({ source: { url: 'https://images.example/slow.jpg' } })
        const image = await ep.process({ source: { url: 'https://images.example/a.jpg' } })
        await eventually(() => fake.queueFullRefused === 1)
        image.cancel()
        expect(await all(image)).toEqual([])
        // only the slow job runs on
        await eventually(() => ep.pendingJobs() === 1)
        expect(await all(slow)).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
        expect(fake.queueFullRefused).toBe(1)
        expect(sources(only()).map(s => s['url'])).toEqual(['https://images.example/slow.jpg', 'https://images.example/a.jpg'])
    })

    test('a source cancelled before its queue_full refusal arrives is not counted as open', async () => {
        fake.queueFullAt = 1
        fake.queueFullDelayMs = 50
        // Far longer than the refusal's delay, so the refusal arrives before the slow source ends.
        fake.sourceDelayMs = 500
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const slow = await ep.process({ source: { url: 'https://images.example/slow.jpg' } })
        const image = await ep.process({ source: { url: 'https://images.example/a.jpg' } })
        await eventually(() => sources(only()).length === 2)
        image.cancel()
        expect(await all(image)).toEqual([])
        // The refusal arrives after the cancel, before the slow source ends.
        expect(await all(slow)).toEqual([prediction(0), prediction(1)])
        // With none of the endpoint's sources open, the refusal rejects instead of waiting for room.
        fake.refusals.push('queue_full')
        const refused = await all(await ep.process({ source: { url: 'https://images.example/b.jpg' } })).catch(e => e)
        expect(refused).toBeInstanceOf(PipelineCommandError)
        expect(refused.error).toBe('queue_full')
        await ep.disconnect()
    })

    test('a send waiting for room goes once the last source in flight is refused', async () => {
        fake.sourceDelayMs = 200
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const slow = await ep.process({ source: { url: 'https://images.example/slow.jpg' } })
        await eventually(() => sources(only()).length === 1)
        await new Promise(resolve => setTimeout(resolve, 20))
        // a is refused at once while slow plays, and waits for room behind b; b's refusal comes after slow ended.
        fake.refusals.push('queue_full')
        fake.queueFullAt = 1
        fake.queueFullDelayMs = 400
        const jobs = await Promise.all(['a', 'b'].map(name => ep.process({ source: { url: `https://images.example/${name}.jpg` } })))
        const results = await Promise.all([slow, ...jobs].map(all))
        expect(results).toEqual([0, 1, 2].map(() => [prediction(0), prediction(1)]))
        expect(sources(only()).filter(source => source['url'] === 'https://images.example/a.jpg')).toHaveLength(2)
        await ep.disconnect()
    })

    test('sources refused with none taken reject instead of sending each other again', async () => {
        fake.queueFullAt = 0
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const jobs = await Promise.all(['a', 'b'].map(name => ep.process({ source: { url: `https://images.example/${name}.jpg` } })))
        const refused = await Promise.all(jobs.map(job => all(job).catch(e => e)))
        expect(refused.map(e => e.error)).toEqual(['queue_full', 'queue_full'])
        expect(fake.queueFullRefused).toBe(2)
        await ep.disconnect()
    })

    test('a source refused for another reason is not counted as open', async () => {
        fake.refusals.push('invalid_request')
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        expect((await all(await ep.process({ source: { url: 'https://images.example/a.jpg' } })).catch(e => e)).error).toBe('invalid_request')
        fake.refusals.push('queue_full')
        expect((await all(await ep.process({ source: { url: 'https://images.example/b.jpg' } })).catch(e => e)).error).toBe('queue_full')
        await ep.disconnect()
    })

    test('an upload from a stream refused queue_full rejects', async () => {
        fake.queueFullAt = 1
        fake.sourceDelayMs = 300
        const ep = endpoint({ pipelineSockets: 1 })
        await ep.connect()
        const slow = await ep.process({ source: { url: 'https://images.example/slow.jpg' } })
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('jpeg bytes'))
                controller.close()
            },
        })
        // Its first bytes were read for the refused send; it cannot be sent again whole.
        const refused = await all(await ep.process({ source: { stream, mimeType: 'image/jpeg' } })).catch(e => e)
        expect(refused).toBeInstanceOf(PipelineCommandError)
        expect(refused.error).toBe('queue_full')
        await all(slow)
        await ep.disconnect()
    })

    test('a batch spreads over pipelineSockets sockets, each with the pop', async () => {
        let release!: () => void
        fake.sourceGate = new Promise(resolve => (release = resolve))
        const urls = Array.from({ length: 12 }, (_, n) => `https://images.example/${n}.jpg`)
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        const jobs = []
        for (const url of urls) {
            jobs.push(await ep.process({ source: { url } }))
        }
        // No source ends before the fake has every one of them.
        await eventually(() => fake.sockets.flatMap(sources).length === urls.length)
        release()
        const results = await Promise.all(jobs.map(all))
        await ep.disconnect()
        expect(results.every(r => r.length === 2)).toBe(true)
        expect(fake.sockets).toHaveLength(PIPELINE_SOCKETS)
        expect(PIPELINE_SOCKETS).toBe(4)
        expect(fake.sockets.every(socket => JSON.stringify(pops(socket)) === JSON.stringify([PERSON]))).toBe(true)
        // Each job went on the socket with the fewest open sources, and none ended meanwhile.
        expect(fake.sockets.map(socket => sources(socket).length)).toEqual([3, 3, 3, 3])
        expect(fake.sockets.flatMap(socket => sources(socket).map(s => s['url'])).sort()).toEqual([...urls].sort())
    })

    test('jobs one after another stay on one socket', async () => {
        const ep = endpoint()
        await ep.connect()
        for (const n of [0, 1, 2]) {
            expect(await all(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))).toEqual([prediction(0), prediction(1)])
        }
        await ep.disconnect()
        expect(fake.sockets).toHaveLength(1)
    })

    test('changePop reaches every open socket', async () => {
        fake.sourceDelayMs = 200
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        const jobs = []
        for (const n of [0, 1, 2, 3]) {
            jobs.push(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))
        }
        await Promise.all(jobs.map(all))
        await ep.changePop(VEHICLE)
        await ep.disconnect()
        expect(fake.sockets).toHaveLength(4)
        expect(fake.sockets.every(socket => JSON.stringify(pops(socket)) === JSON.stringify([PERSON, VEHICLE]))).toBe(true)
    })

    test('changePop goes on to the other sockets when one closes under it', async () => {
        fake.sourceDelayMs = 200
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        const batch = async () => {
            const jobs = []
            for (const n of [0, 1, 2, 3]) {
                jobs.push(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))
            }
            await Promise.all(jobs.map(all))
        }
        await batch()
        fake.closeOnPop = 1
        await ep.changePop(VEHICLE)
        await batch()
        await ep.disconnect()
        expect(fake.sockets).toHaveLength(5)
        expect(ep.pop()).toEqual(VEHICLE)
        // The sockets after the closed one get the new pop, and so does the one opened in its place.
        expect(fake.sockets.map(socket => pops(socket).slice(-1)[0])).toEqual([VEHICLE, VEHICLE, VEHICLE, VEHICLE, VEHICLE])
    })

    test('changePop skips a socket that closed while it set the pop on another', async () => {
        fake.sourceDelayMs = 200
        const ep = endpoint({ pop: PERSON })
        await ep.connect()
        const jobs = []
        for (const n of [0, 1, 2, 3]) {
            jobs.push(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))
        }
        await Promise.all(jobs.map(all))
        fake.popDelayMs = 200
        const changed = ep.changePop(VEHICLE)
        await new Promise(resolve => setTimeout(resolve, 50))
        fake.closeSocket(3)
        await changed
        await ep.disconnect()
        expect(ep.pop()).toEqual(VEHICLE)
    })

    test('another socket the pipeline API refuses does not hold up the job', async () => {
        fake.sourceDelayMs = 200
        const ep = endpoint()
        await ep.connect()
        fake.upgradeAnswers.push({ status: 503, headers: { 'Retry-After': '5' } })
        const started = Date.now()
        const jobs = []
        for (const n of [0, 1]) {
            jobs.push(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))
        }
        const results = await Promise.all(jobs.map(all))
        await ep.disconnect()
        expect(results.every(r => r.length === 2)).toBe(true)
        // the second job went on the open socket instead of waiting 5 s
        expect(Date.now() - started).toBeLessThan(2000)
        expect(fake.sockets).toHaveLength(1)
    })

    test('a socket that finishes opening after disconnect started is closed', async () => {
        fake.closes.set(1, [1001, 'shutting_down'])
        const ep = endpoint()
        await ep.connect()
        fake.upgradeDelayMs = 300
        // The close reopens the socket at once; disconnect starts while that upgrade is held.
        const closed = await all(await ep.process({ source: { url: 'https://images.example/0.jpg' } })).catch(e => e)
        expect(closed).toBeInstanceOf(PipelineSocketClosedError)
        await eventually(() => fake.upgrades === 2)
        await ep.disconnect()
        await new Promise(resolve => setTimeout(resolve, 500))
        expect(fake.openSockets).toBe(0)
    })

    test('after the pipeline API refused another socket, the next jobs do not ask again at once', async () => {
        fake.sourceDelayMs = 50
        const ep = endpoint()
        await ep.connect()
        fake.upgradeAnswers.push({ status: 503 }, { status: 503 }, { status: 503 })
        const jobs = []
        for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
            jobs.push(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))
        }
        const results = await Promise.all(jobs.map(all))
        await ep.disconnect()
        expect(results.every(r => r.length === 2)).toBe(true)
        expect(fake.upgradeAnswers).toHaveLength(2)
        expect(fake.sockets).toHaveLength(1)
    })

    test('a camera gets a socket of its own, and no image of a batch queues behind it', async () => {
        fake.sourceDelayMs = 50
        const ep = endpoint()
        await ep.connect()
        const live = await ep.process({ source: { url: 'rtsp://camera.example/stream' } })
        expect((await live[Symbol.asyncIterator]().next()).value).toEqual(prediction(0))
        const jobs = []
        for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
            jobs.push(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))
        }
        const results = await Promise.all(jobs.map(all))
        live.cancel()
        await ep.disconnect()
        expect(results.every(r => r.length === 2)).toBe(true)
        expect(sources(only()).map(s => s['url'])).toEqual(['rtsp://camera.example/stream'])
        expect(fake.sockets).toHaveLength(1 + PIPELINE_SOCKETS)
    })

    // Handing a session to another endpoint

    test('a client built from a pipeline mode session runs in pipeline mode with the session token', async () => {
        const server = endpoint()
        await server.connect()
        const shared = JSON.parse(JSON.stringify(await server.session()))
        expect(shared.isPipelineMode).toBe(true)
        // the token's own expiry: the fake mints tokens for an hour, less the minute the SDK keeps in hand
        expect(shared.validUntil).toBeGreaterThan(Date.now() + 58 * 60 * 1000)
        expect(shared.validUntil).toBeLessThan(Date.now() + 60 * 60 * 1000)

        const client = EyePop.workerEndpoint({ session: shared, logger: pino({ level: 'silent' }) })
        expect(inPipelineMode(client)).toBe(true)
        expect((client as any)._limit.getPermits()).toBe(256)
        await client.connect()
        expect(await all(await client.process({ source: { url: 'https://images.example/a.jpg' } }))).toEqual([prediction(0), prediction(1)])
        await client.disconnect()
        await server.disconnect()
        expect(fake.sockets.map(s => s.authorization)).toEqual(['Bearer minted-1', 'Bearer minted-1'])
        expect(fake.exchanges).toHaveLength(1)
    })

    test('a client built from a worker session stays in session mode', () => {
        const session = { eyepopUrl: fake.url, accessToken: 't', validUntil: Date.now() + 60000, popId: 'transient', baseUrl: fake.url, pipelineId: 'p', isPipelineMode: false }
        expect(EyePop.workerEndpoint({ session: session as any }).backend()).toBeInstanceOf(SessionBackend)
    })

    test('an explicit isPipelineMode wins over the session it is built from', () => {
        const session = { eyepopUrl: fake.url, accessToken: 't', validUntil: Date.now() + 60000, popId: 'transient', baseUrl: fake.url, pipelineId: undefined, isPipelineMode: true }
        expect(EyePop.workerEndpoint({ session: session as any, isPipelineMode: false }).backend()).toBeInstanceOf(SessionBackend)
    })

    test('a client built from a pipeline mode session refuses a worker session named by the environment', () => {
        process.env['EYEPOP_SESSION_UUID'] = 'a-session'
        const session = { eyepopUrl: fake.url, accessToken: 't', validUntil: Date.now() + 60000, popId: 'transient', baseUrl: fake.url, pipelineId: undefined, isPipelineMode: true }
        expect(refusal(() => EyePop.workerEndpoint({ session: session as any }))).toMatchObject({ problem: 'session_options', options: ['sessionUuid'] })
    })

    test('a worker session says it is not in pipeline mode', async () => {
        const backend = new SessionBackend({
            options: { popId: 'transient' },
            credentialSession: async () => ({ eyepopUrl: fake.url, accessToken: 't', validUntil: 1 }),
        } as any)
        ;(backend as any)._baseUrl = fake.url
        expect((await backend.session()).isPipelineMode).toBe(false)
    })

    // WHIP over the socket

    test('a media stream is a whip source signalled with whipIceServers, whipOffer and whipIce', async () => {
        const stopped: string[] = []
        const track = { stop: () => stopped.push('track') }
        const mediaStream = { getTracks: () => [track] } as unknown as MediaStream
        const peers: any[] = []
        class FakePeerConnection {
            onicecandidate: ((evt: any) => void) | null = null
            remote: any = null
            constructor(readonly config: any) {
                peers.push(this)
            }
            addTrack() {}
            async createOffer() {
                return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:u\r\na=ice-pwd:p\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' }
            }
            async setLocalDescription() {
                this.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 9 typ host', sdpMLineIndex: 0 } })
            }
            async setRemoteDescription(answer: any) {
                this.remote = answer
            }
            close() {}
        }
        ;(globalThis as any).RTCPeerConnection = FakePeerConnection
        try {
            const ep = endpoint()
            await ep.connect()
            const live = await ep.process({ source: { mediaStream } })
            const iterator = live[Symbol.asyncIterator]()
            expect((await iterator.next()).value).toEqual(prediction(0))
            await eventually(() => only().commands.some(c => c['type'] === 'whipIce'))
            live.cancel()
            await ep.disconnect()
        } finally {
            delete (globalThis as any).RTCPeerConnection
        }
        const [source] = sources(only()) as [Record<string, any>]
        const ingressId = source['whip']['ingressId']
        const whip = only().commands.filter(c => String(c['type']).startsWith('whip'))
        expect(whip.map(c => c['type'])).toEqual(['whipIceServers', 'whipOffer', 'whipIce'])
        expect(whip.every(c => c['ingressId'] === ingressId)).toBe(true)
        expect(whip[2]?.['fragment']).toContain('a=candidate:1 1 udp 1 10.0.0.1 9 typ host')
        expect(peers[0].config.iceServers[0].urls).toEqual(['stun:stun.example:3478'])
        expect(peers[0].remote.sdp).toMatch(/^answer to v=0/)
        expect(stopped).toEqual(['track'])
    })

    test('a whip whose WebRTC connection fails ends the job with the failure and stops its source', async () => {
        const mediaStream = { getTracks: () => [{ stop: () => {} }] } as unknown as MediaStream
        class FailingPeerConnection {
            onicecandidate: ((evt: any) => void) | null = null
            oniceconnectionstatechange: (() => void) | null = null
            iceConnectionState = 'new'
            constructor(readonly config: any) {}
            addTrack() {}
            async createOffer() {
                return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:u\r\na=ice-pwd:p\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' }
            }
            async setLocalDescription() {}
            async setRemoteDescription() {
                // As a browser does once no candidate pair connects.
                setTimeout(() => {
                    this.iceConnectionState = 'failed'
                    this.oniceconnectionstatechange?.()
                }, 10)
            }
            close() {}
        }
        ;(globalThis as any).RTCPeerConnection = FailingPeerConnection
        let failure: unknown = null
        try {
            const ep = endpoint()
            await ep.connect()
            const live = await ep.process({ source: { mediaStream } })
            try {
                for await (const _ of live) {
                    // the fake's predictions until the failure
                }
            } catch (error) {
                failure = error
            }
            await ep.disconnect()
        } finally {
            delete (globalThis as any).RTCPeerConnection
        }
        expect(String(failure)).toMatch(/WebRTC connection of whip ingress .* failed/)
        expect(only().commands).toContainEqual({ type: 'stopSource', id: sources(only())[0]?.['id'] })
    })
})

jest.setTimeout(20000)
