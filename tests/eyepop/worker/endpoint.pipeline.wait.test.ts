import { EyePop, PIPELINE_WAIT_TIMEOUT_SECS, PipelineCommandError, PipelineConfigurationError, PipelineOverloadedError, PipelineSocketClosedError, Prediction, ResultStream, WorkerEndpoint } from '../../../src/eyepop'
import { UpgradeError } from '../../../src/eyepop/shims/websockets'
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { performance } from 'node:perf_hooks'
import { pino } from 'pino'
import { FakePipelineApi, prediction } from './pipeline_fake'

// A refused pipeline socket is waited through. The pipeline API is the fake, on real sockets; the clock is
// fake, so a wait of minutes takes no time: a test moves it by exactly the wait it expects and checks that
// the next attempt comes then and not before.

const ENV = ['EYEPOP_URL', 'EYEPOP_API_KEY', 'EYEPOP_PIPELINE_MODE', 'EYEPOP_LOCAL_MODE', 'EYEPOP_ENV', 'EYEPOP_PIPELINE_WAIT_TIMEOUT']

async function all(stream: ResultStream): Promise<Prediction[]> {
    const results: Prediction[] = []
    for await (const result of stream) {
        results.push(result)
    }
    return results
}

// Lets the real event loop, which carries the sockets, run; the fake clock does not move.
async function io(turns: number = 30): Promise<void> {
    for (let turn = 0; turn < turns; turn++) {
        await new Promise(resolve => setImmediate(resolve))
    }
}

async function until(check: () => boolean): Promise<void> {
    const started = performance.now()
    while (!check()) {
        if (performance.now() - started > 3000) {
            throw new Error('condition not met in time')
        }
        await io(1)
    }
}

describe('pipeline mode waits for capacity', () => {
    let fake: FakePipelineApi
    let saved: Record<string, string | undefined>
    let logs: Array<{ level: number; msg: string }>

    beforeEach(async () => {
        saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]))
        ENV.forEach(name => delete process.env[name])
        fake = new FakePipelineApi()
        await fake.start()
        logs = []
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'hrtime', 'performance'] })
        // No jitter unless a test asks for it, so that a wait is the Retry-After itself.
        jest.spyOn(Math, 'random').mockReturnValue(0)
    })

    afterEach(async () => {
        jest.useRealTimers()
        jest.restoreAllMocks()
        await fake.stop()
        ENV.forEach(name => (saved[name] === undefined ? delete process.env[name] : (process.env[name] = saved[name])))
    })

    function endpoint(options: Record<string, any> = {}): WorkerEndpoint {
        const logger = pino({ level: 'debug' }, { write: (line: string) => logs.push(JSON.parse(line)) })
        return EyePop.workerEndpoint({ eyepopUrl: fake.url, apiKey: 'the api key', isPipelineMode: true, logger, ...options })
    }

    const refused = (times: number, status: number = 503, headers?: Record<string, string>) => {
        for (let n = 0; n < times; n++) {
            fake.upgradeAnswers.push(headers === undefined ? { status } : { status, headers })
        }
    }

    // The nth upgrade was refused and the endpoint sleeps, with nothing else pending.
    async function sleeping(upgrades: number): Promise<void> {
        await until(() => fake.upgrades === upgrades && jest.getTimerCount() === 1)
    }

    // The sleeping endpoint asks again after `ms` and not before.
    async function asksAgainAfter(ms: number, upgrades: number): Promise<void> {
        await sleeping(upgrades)
        await jest.advanceTimersByTimeAsync(ms - 1)
        await io()
        expect(fake.upgrades).toBe(upgrades)
        await jest.advanceTimersByTimeAsync(1)
        await until(() => fake.upgrades === upgrades + 1)
    }

    const outcome = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => undefined, error => error)

    test('honours the Retry-After of each refusal, and a later one is at least half as long again', async () => {
        refused(1, 503, { 'Retry-After': '3' })
        refused(1, 503, { 'Retry-After': '4' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(3000, 1)
        await asksAgainAfter(6000, 2)
        await connecting
        expect(fake.sockets).toHaveLength(1)
        await ep.disconnect()
    })

    test('waits at least a second, whatever a Retry-After of 0 says', async () => {
        refused(1, 503, { 'Retry-After': '0' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(1000, 1)
        await connecting
        await ep.disconnect()
    })

    test('a 429 is waited through like a 503', async () => {
        refused(1, 429, { 'Retry-After': '4' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(4000, 1)
        await connecting
        expect(fake.sockets).toHaveLength(1)
        await ep.disconnect()
    })

    test.each([
        [0, [500, 1000, 2000, 4000, 5000, 5000]],
        [1, [1000, 2000, 4000, 8000, 10000, 10000]],
    ])('without Retry-After the wait is a jittered backoff of 1, 2, 4, 8, 10 s (random %d)', async (random, waits) => {
        jest.spyOn(Math, 'random').mockReturnValue(random)
        refused(6)
        const ep = endpoint()
        const connecting = ep.connect()
        for (const [n, wait] of waits.entries()) {
            await asksAgainAfter(wait, n + 1)
        }
        await connecting
        expect(fake.sockets).toHaveLength(1)
        await ep.disconnect()
    })

    test.each([
        [0, [2000, 3000, 4500, 6750, 10000, 10000]],
        [1, [3000, 4500, 6750, 10125, 15000, 15000]],
    ])('a repeated Retry-After grows by half to 10 s and gets up to half more, never less (random %d)', async (random, waits) => {
        jest.spyOn(Math, 'random').mockReturnValue(random)
        refused(6, 503, { 'Retry-After': '2' })
        const ep = endpoint()
        const connecting = ep.connect()
        for (const [n, wait] of waits.entries()) {
            await asksAgainAfter(wait, n + 1)
        }
        await connecting
        await ep.disconnect()
    })

    test('a Retry-After above the cap is never shortened', async () => {
        refused(3, 503, { 'Retry-After': '30' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(30000, 1)
        await asksAgainAfter(30000, 2)
        await asksAgainAfter(30000, 3)
        await connecting
        await ep.disconnect()
    })

    test.each(['Infinity', 'NaN', '-3', 'tomorrow', 'Wed, 21 Oct 2026 07:28:00 GMT'])('a Retry-After of %s is not a wait: the backoff applies', async value => {
        refused(1, 503, { 'Retry-After': value })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(500, 1)
        await connecting
        await ep.disconnect()
    })

    test('a Retry-After under a second is a second', async () => {
        refused(1, 503, { 'Retry-After': '0.5' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(1000, 1)
        await connecting
        await ep.disconnect()
    })

    test('a huge Retry-After is cut to the time left, and then the endpoint gives up', async () => {
        refused(5, 503, { 'Retry-After': '1000000000' })
        const ep = endpoint({ pipelineWaitTimeout: 20 })
        const failed = outcome(ep.connect())
        await asksAgainAfter(20000, 1)
        const error = (await failed) as PipelineOverloadedError
        expect(error).toBeInstanceOf(PipelineOverloadedError)
        expect(error.waitedSecs).toBe(20)
        expect(fake.upgrades).toBe(2)
    })

    test('a wait that would pass the limit is cut to what is left, and then the endpoint gives up', async () => {
        refused(10, 503, { 'Retry-After': '2' })
        const ep = endpoint({ pipelineWaitTimeout: 5 })
        const failed = outcome(ep.connect())
        await asksAgainAfter(2000, 1)
        await asksAgainAfter(3000, 2)
        const error = (await failed) as PipelineOverloadedError
        expect(error).toBeInstanceOf(PipelineOverloadedError)
        expect(error).toBeInstanceOf(PipelineCommandError)
        expect(error.error).toBe('overloaded')
        expect(error.waitedSecs).toBe(5)
        expect(error.message).toContain('pipelineWaitTimeout')
        expect((error as any).cause).toBeInstanceOf(UpgradeError)
        expect((error as any).cause.status).toBe(503)
        expect(fake.upgrades).toBe(3)
        expect(jest.getTimerCount()).toBe(0)
    })

    test('the wait is 600 s unless told otherwise', async () => {
        expect(PIPELINE_WAIT_TIMEOUT_SECS).toBe(600)
        refused(10, 503, { 'Retry-After': '300' })
        const ep = endpoint()
        const failed = outcome(ep.connect())
        await asksAgainAfter(300 * 1000, 1)
        await asksAgainAfter(300 * 1000, 2)
        const error = (await failed) as PipelineOverloadedError
        expect(error).toBeInstanceOf(PipelineOverloadedError)
        expect(error.waitedSecs).toBe(600)
        expect(fake.upgrades).toBe(3)
    })

    test('0 does not wait: the first refusal raises', async () => {
        refused(1, 503, { 'Retry-After': '1' })
        const ep = endpoint({ pipelineWaitTimeout: 0 })
        const error = (await outcome(ep.connect())) as PipelineOverloadedError
        expect(error).toBeInstanceOf(PipelineOverloadedError)
        expect(error.waitedSecs).toBe(0)
        expect(fake.upgrades).toBe(1)
        expect(jest.getTimerCount()).toBe(0)
    })

    test('an 401 is not waited for: the API key is exchanged again at once', async () => {
        fake.upgradeAnswers.push({ status: 401 })
        const ep = endpoint()
        await ep.connect()
        expect(fake.upgrades).toBe(2)
        expect(jest.getTimerCount()).toBe(1)
        await ep.disconnect()
    })

    test.each([500, 404, 403])('a %d, even with Retry-After, raises at once as before', async status => {
        refused(1, status, { 'Retry-After': '5' })
        const ep = endpoint()
        const error = (await outcome(ep.connect())) as UpgradeError
        expect(error).toBeInstanceOf(UpgradeError)
        expect(error.status).toBe(status)
        expect(fake.upgrades).toBe(1)
        expect(jest.getTimerCount()).toBe(0)
    })

    test('a job that needs a new socket waits for it', async () => {
        const ep = endpoint()
        await ep.connect()
        fake.closeSocket(0)
        await until(() => fake.openSockets === 0)
        await io()
        refused(2, 503, { 'Retry-After': '10' })
        const job = ep.process({ source: { url: 'https://images.example/a.jpg' } }).then(all)
        await asksAgainAfter(10000, 2)
        await asksAgainAfter(10000, 3)
        expect(await job).toEqual([prediction(0), prediction(1)])
        expect(fake.sockets).toHaveLength(2)
        await ep.disconnect()
    })

    test('a disconnect ends the wait and leaves no timer', async () => {
        refused(10, 503, { 'Retry-After': '60' })
        const ep = endpoint()
        const connecting = outcome(ep.connect())
        await sleeping(1)
        await ep.disconnect()
        expect(await connecting).toBeInstanceOf(PipelineSocketClosedError)
        expect(jest.getTimerCount()).toBe(0)
        await jest.advanceTimersByTimeAsync(10 * 60 * 1000)
        await io()
        expect(fake.upgrades).toBe(1)
    })

    test('an 401 and then refusals exchange the API key once, not on every retry', async () => {
        fake.upgradeAnswers.push({ status: 401 })
        refused(3, 503, { 'Retry-After': '1' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(1000, 2)
        await asksAgainAfter(1500, 3)
        await asksAgainAfter(2250, 4)
        await connecting
        expect(fake.exchanges).toHaveLength(2)
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-2')
        await ep.disconnect()
    })

    test('a second 401 after a wait still raises', async () => {
        refused(1, 503, { 'Retry-After': '1' })
        fake.upgradeAnswers.push({ status: 401 }, { status: 401 })
        const ep = endpoint()
        const connecting = outcome(ep.connect())
        await asksAgainAfter(1000, 1)
        expect(await connecting).toBeInstanceOf(UpgradeError)
        expect(fake.exchanges).toHaveLength(2)
    })

    test('jobs queued behind a socket that gave up fail with it at once, not after a wait of their own', async () => {
        const ep = endpoint({ pipelineWaitTimeout: 100 })
        await ep.connect()
        fake.closeSocket(0)
        await until(() => fake.openSockets === 0)
        await io()
        refused(50, 503, { 'Retry-After': '10' })
        const jobs = []
        for (const n of [0, 1, 2]) {
            jobs.push(outcome(all(await ep.process({ source: { url: `https://images.example/${n}.jpg` } }))))
        }
        // The first job waits 100 s in all: attempts at 0, 10, ... 100 s.
        for (let attempt = 1; attempt <= 10; attempt++) {
            await asksAgainAfter(10000, attempt + 1)
        }
        const errors = (await Promise.all(jobs)) as PipelineOverloadedError[]
        for (const error of errors) {
            expect(error).toBeInstanceOf(PipelineOverloadedError)
        }
        expect(errors[0]!.waitedSecs).toBe(100)
        // the other two asked once each, and no clock moved for them
        expect(fake.upgrades).toBe(1 + 11 + 2)
        expect(jest.getTimerCount()).toBe(0)
    })

    test('the give-up is forgotten after a few seconds: a later job gets a wait of its own', async () => {
        const ep = endpoint({ pipelineWaitTimeout: 10 })
        await ep.connect()
        fake.closeSocket(0)
        await until(() => fake.openSockets === 0)
        await io()
        refused(2, 503, { 'Retry-After': '10' })
        const first = outcome(all(await ep.process({ source: { url: 'https://images.example/0.jpg' } })))
        await asksAgainAfter(10000, 2)
        expect(await first).toBeInstanceOf(PipelineOverloadedError)
        await jest.advanceTimersByTimeAsync(60 * 1000)
        refused(1, 503, { 'Retry-After': '3' })
        const second = all(await ep.process({ source: { url: 'https://images.example/1.jpg' } }))
        await asksAgainAfter(3000, 4)
        expect(await second).toEqual([prediction(0), prediction(1)])
        await ep.disconnect()
    })

    test('cancelling the job that waits ends the wait and leaves no timer', async () => {
        const ep = endpoint()
        await ep.connect()
        fake.closeSocket(0)
        await until(() => fake.openSockets === 0)
        await io()
        refused(10, 503, { 'Retry-After': '60' })
        const stream = await ep.process({ source: { url: 'https://images.example/a.jpg' } })
        const done = all(stream)
        await sleeping(2)
        stream.cancel()
        expect(await done).toEqual([])
        expect(jest.getTimerCount()).toBe(0)
        await jest.advanceTimersByTimeAsync(10 * 60 * 1000)
        await io()
        expect(fake.upgrades).toBe(2)
        await ep.disconnect()
    })

    test('a disconnect ends the wait of a job at once, instead of holding for the whole limit', async () => {
        const ep = endpoint()
        await ep.connect()
        fake.closeSocket(0)
        await until(() => fake.openSockets === 0)
        await io()
        refused(10, 503, { 'Retry-After': '60' })
        const job = outcome(all(await ep.process({ source: { url: 'https://images.example/a.jpg' } })))
        await sleeping(2)
        await ep.disconnect()
        expect(await job).toBeInstanceOf(PipelineSocketClosedError)
        expect(jest.getTimerCount()).toBe(0)
    })

    test('logs the first wait at warn, so that a wait is never silent, and each retry at debug', async () => {
        refused(2, 503, { 'Retry-After': '2' })
        const ep = endpoint()
        const connecting = ep.connect()
        await asksAgainAfter(2000, 1)
        await asksAgainAfter(3000, 2)
        await connecting
        await ep.disconnect()
        const waiting = logs.filter(line => line.msg.includes('no capacity'))
        expect(waiting).toHaveLength(1)
        expect(waiting[0]!.level).toBe(40)
        expect(waiting[0]!.msg).toContain('Retry-After 2')
        expect(waiting[0]!.msg).toContain('Waiting up to 600 s')
        const retries = logs.filter(line => line.msg.includes('retrying in'))
        expect(retries).toHaveLength(2)
        expect(retries.every(line => line.level === 20)).toBe(true)
    })

    describe('the option', () => {
        test('EYEPOP_PIPELINE_WAIT_TIMEOUT sets it, and the option beats it', async () => {
            process.env['EYEPOP_PIPELINE_WAIT_TIMEOUT'] = '0'
            refused(1)
            const error = await outcome(endpoint().connect())
            expect(error).toBeInstanceOf(PipelineOverloadedError)

            process.env['EYEPOP_PIPELINE_WAIT_TIMEOUT'] = '0'
            refused(1, 503, { 'Retry-After': '1' })
            const ep = endpoint({ pipelineWaitTimeout: 600 })
            const connecting = ep.connect()
            await asksAgainAfter(1000, 2)
            await connecting
            await ep.disconnect()
        })

        test.each(['soon', '-1', 'Infinity'])('EYEPOP_PIPELINE_WAIT_TIMEOUT=%s is refused', value => {
            process.env['EYEPOP_PIPELINE_WAIT_TIMEOUT'] = value
            expect(() => endpoint()).toThrow(PipelineConfigurationError)
            expect(() => endpoint()).toThrow('EYEPOP_PIPELINE_WAIT_TIMEOUT')
        })

        test('an empty EYEPOP_PIPELINE_WAIT_TIMEOUT is unset', () => {
            process.env['EYEPOP_PIPELINE_WAIT_TIMEOUT'] = ''
            expect(() => endpoint()).not.toThrow()
        })

        test.each([-1, NaN, Infinity])('pipelineWaitTimeout %d is refused', value => {
            expect(() => endpoint({ pipelineWaitTimeout: value })).toThrow(PipelineConfigurationError)
        })
    })
})
