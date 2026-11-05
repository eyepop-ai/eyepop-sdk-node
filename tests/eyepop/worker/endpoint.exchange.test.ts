import { EyePop, WorkerEndpoint } from '../../../src/eyepop'
import { UpgradeError } from '../../../src/eyepop/shims/websockets'
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { pino } from 'pino'
import { FakePipelineApi } from './pipeline_fake'

const ENV = ['EYEPOP_URL', 'EYEPOP_API_KEY', 'EYEPOP_ACCOUNT_UUID', 'EYEPOP_ACCOUNT_ID', 'EYEPOP_POP_ID', 'EYEPOP_SESSION_UUID', 'EYEPOP_PIPELINE_MODE', 'EYEPOP_LOCAL_MODE']

describe('exchanging a credential at the compute API', () => {
    let fake: FakePipelineApi
    let saved: Record<string, string | undefined>

    beforeEach(async () => {
        saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]))
        ENV.forEach(name => delete process.env[name])
        fake = new FakePipelineApi()
        await fake.start()
    })

    afterEach(async () => {
        jest.restoreAllMocks()
        await fake.stop()
        ENV.forEach(name => (saved[name] === undefined ? delete process.env[name] : (process.env[name] = saved[name])))
    })

    function endpoint(credential: Record<string, string>): WorkerEndpoint {
        return EyePop.workerEndpoint({ eyepopUrl: fake.url, isPipelineMode: true, logger: pino({ level: 'silent' }), ...credential })
    }

    test('an API key is exchanged without an account', async () => {
        const ep = endpoint({ apiKey: 'the api key', accountId: 'the-account' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual(['Bearer the api key'])
        expect(fake.exchangeQueries).toEqual([''])
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-1')
    })

    test('a login token is exchanged and the exchanged token is the one sent', async () => {
        const ep = endpoint({ accessToken: 'the login token' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual(['Bearer the login token'])
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-1')
    })

    test('a login token is exchanged for the named account', async () => {
        const ep = endpoint({ accessToken: 'the login token', accountId: 'the account/uuid' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchangeQueries).toEqual(['account_uuid=the%20account%2Fuuid'])
    })

    test('a token the compute API takes for neither an API key nor a login is used as is', async () => {
        fake.exchangeAnswers.push({ status: 401, body: '{"code":"AUTH_001"}' })
        const ep = endpoint({ accessToken: 'already exchanged' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.sockets[0]!.authorization).toBe('Bearer already exchanged')
    })

    test('a login the compute API forbids for the account is not used as is', async () => {
        fake.exchangeAnswers.push({ status: 403, body: '{"code":"AUTHZ_001"}' }, { status: 403, body: '{"code":"AUTHZ_001"}' })
        const ep = endpoint({ accessToken: 'the login token' })

        const connecting = ep.connect()

        await expect(connecting).rejects.toBeDefined()
        expect(fake.upgrades).toBe(0)
    })

    test('a 401 on the upgrade exchanges the login token again and retries once', async () => {
        fake.upgradeAnswers.push({ status: 401 })
        const ep = endpoint({ accessToken: 'the login token' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual(['Bearer the login token', 'Bearer the login token'])
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-2')
    })

    test('a second 401 on the upgrade surfaces', async () => {
        fake.upgradeAnswers.push({ status: 401 }, { status: 401 })
        const ep = endpoint({ accessToken: 'the login token' })

        const connecting = ep.connect()

        await expect(connecting).rejects.toBeInstanceOf(UpgradeError)
        expect(fake.exchanges).toHaveLength(2)
    })

    test('an exchanged token is kept until its expires_in less the margin', async () => {
        fake.expiresIn = 120
        const ep = endpoint({ accessToken: 'the login token' })
        await ep.connect()
        const connected = Date.now()
        const now = jest.spyOn(Date, 'now')

        now.mockReturnValue(connected + 50_000)
        await ep.session()
        expect(fake.exchanges).toHaveLength(1)
        now.mockReturnValue(connected + 70_000)
        await ep.session()
        await ep.disconnect()

        expect(fake.exchanges).toHaveLength(2)
    })
})
