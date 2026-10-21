import { EyePop, PipelineCommandError, PipelineEndpoint, PipelineSocketClosedError, PipelineSourceError, Pop, Prediction, ResultStream } from '../../../src/eyepop'
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pino } from 'pino'
import { FakePipelineApi, FakeSocket, pops, prediction, sources } from './pipeline_fake'

const PERSON: Pop = { components: [{ type: 'inference', ability: 'eyepop.person:latest' } as any] }
const VEHICLE: Pop = { components: [{ type: 'inference', ability: 'eyepop.vehicle:latest' } as any] }

const ENV = ['EYEPOP_URL', 'EYEPOP_API_KEY', 'EYEPOP_POP_ID', 'EYEPOP_SESSION_UUID', 'EYEPOP_IS_PIPELINE_MODE', 'EYEPOP_LOCAL_MODE']

async function all(stream: ResultStream): Promise<Prediction[]> {
    const results: Prediction[] = []
    for await (const result of stream) {
        results.push(result)
    }
    return results
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

    function endpoint(options: Record<string, any> = {}): PipelineEndpoint {
        const logger = pino({ level: 'warn' }, { write: (line: string) => warnings.push(JSON.parse(line).msg) })
        const created = EyePop.workerEndpoint({ eyepopUrl: fake.url, apiKey: 'the api key', isPipelineMode: true, logger, ...options })
        expect(created).toBeInstanceOf(PipelineEndpoint)
        return created as PipelineEndpoint
    }

    function file(name: string, content: string): string {
        const path = join(tmp, name)
        writeFileSync(path, content)
        return path
    }

    const only = (): FakeSocket => fake.sockets[0] as FakeSocket

    // 1. Selection

    test('is selected by the option or the environment', () => {
        expect(EyePop.workerEndpoint({ accessToken: 't', isPipelineMode: true })).toBeInstanceOf(PipelineEndpoint)
        process.env['EYEPOP_IS_PIPELINE_MODE'] = 'true'
        expect(EyePop.workerEndpoint({ accessToken: 't' })).toBeInstanceOf(PipelineEndpoint)
        expect(EyePop.workerEndpoint({ accessToken: 't', isPipelineMode: false })).not.toBeInstanceOf(PipelineEndpoint)
    })

    test.each([{ popId: 'a-named-pop' }, { sessionUuid: 'a-session' }, { sessionName: 'a-name' }, { pipelineImage: 'an-image' }, { pipelineVersion: '4.8.0' }, { jobQueueLength: 257 }])(
        'refuses %p, which only a worker session has',
        option => {
            expect(() => EyePop.workerEndpoint({ apiKey: 'k', isPipelineMode: true, ...option })).toThrow()
        },
    )

    test('refuses a session named by the environment', () => {
        process.env['EYEPOP_SESSION_UUID'] = 'a-session'
        expect(() => EyePop.workerEndpoint({ apiKey: 'k', isPipelineMode: true })).toThrow(/sessionUuid/)
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
        await expect(endpoint().connect()).rejects.toThrow(/pipeline_api_url/)
    })

    test('plain http to a pipeline API off loopback is refused', async () => {
        fake.pipelineApiUrl = 'http://pipeline.example'
        await expect(endpoint().connect()).rejects.toThrow(/https/)
    })

    test('local mode takes eyepopUrl as the pipeline API and sends no credential', async () => {
        const ep = EyePop.workerEndpoint({ eyepopUrl: fake.url, isPipelineMode: true, isLocalMode: true }) as PipelineEndpoint
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
        await expect(ep.changePop(PERSON)).rejects.toThrow(/invalid_request/)
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
        const ep = endpoint()
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

    test('queue_full rejects', async () => {
        fake.refusals.push('queue_full')
        const ep = endpoint()
        await ep.connect()
        await expect(all(await ep.process({ source: { url: 'https://images.example/a.jpg' } }))).rejects.toThrow(/queue_full/)
        await ep.disconnect()
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
})

jest.setTimeout(20000)
