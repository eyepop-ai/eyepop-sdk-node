import { EyePop, WorkerEndpoint } from '../../../src/eyepop'
import { authenticateBrowserSession } from '../../../src/eyepop/shims/browser_session'
import { UpgradeError } from '../../../src/eyepop/shims/websockets'
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { pino } from 'pino'
import { FakePipelineApi } from './pipeline_fake'

jest.mock('../../../src/eyepop/shims/browser_session', () => ({ authenticateBrowserSession: jest.fn() }))

const ENV = ['EYEPOP_URL', 'EYEPOP_API_KEY', 'EYEPOP_ACCOUNT_UUID', 'EYEPOP_ACCOUNT_ID', 'EYEPOP_POP_ID', 'EYEPOP_SESSION_UUID', 'EYEPOP_PIPELINE_MODE', 'EYEPOP_LOCAL_MODE']

function refusal(status: number, code: string, message: string): { status: number; body: string } {
    return { status, body: JSON.stringify({ error: { code, type: 'error', message } }) }
}

const NOT_EXCHANGEABLE = refusal(401, 'AUTH_001', 'API key or user login required to authenticate')
const LOGIN_NOT_EXCHANGEABLE = refusal(401, 'AUTH_001', 'API key authentication required for token refresh')
const EXPIRED = refusal(401, 'AUTH_001', 'Authentication failed')
const FORBIDDEN = refusal(403, 'AUTHZ_001', 'user may not use the account')

function jwt(claims: Record<string, unknown>): string {
    return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

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

    function endpoint(options: Record<string, unknown>): WorkerEndpoint {
        return EyePop.workerEndpoint({ eyepopUrl: fake.url, isPipelineMode: true, logger: pino({ level: 'silent' }), ...options })
    }

    test('an API key is exchanged without an account', async () => {
        const ep = endpoint({ apiKey: 'the api key', accountId: 'the-account' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual(['Bearer the api key'])
        expect(fake.exchangeQueries).toEqual([''])
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-1')
    })

    test('an opaque login token is exchanged and the exchanged token is the one sent', async () => {
        const ep = endpoint({ accessToken: 'the login token' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual(['Bearer the login token'])
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-1')
    })

    test('a login token without an account claim is exchanged', async () => {
        const login = jwt({ sub: 'auth0|user' })
        const ep = endpoint({ accessToken: login })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual([`Bearer ${login}`])
    })

    test('a login token is exchanged for the named account', async () => {
        const ep = endpoint({ accessToken: 'the login token', accountId: 'the account/uuid' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchangeQueries).toEqual(['account_uuid=the%20account%2Fuuid'])
    })

    test('a token that already carries an account is used as is without an exchange', async () => {
        const exchanged = jwt({ 'https://ident.eyepop.ai/account-uuid': 'the-account' })
        const ep = endpoint({ accessToken: exchanged })

        await ep.connect()
        await ep.disconnect()

        expect(fake.exchanges).toEqual([])
        expect(fake.sockets[0]!.authorization).toBe(`Bearer ${exchanged}`)
    })

    test('a token the compute API refuses as an exchanged token is used as is', async () => {
        fake.exchangeAnswers.push(NOT_EXCHANGEABLE)
        const ep = endpoint({ accessToken: 'already exchanged' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.sockets[0]!.authorization).toBe('Bearer already exchanged')
    })

    test('a login token a compute API without login exchange refuses is used as is', async () => {
        fake.exchangeAnswers.push(LOGIN_NOT_EXCHANGEABLE)
        const ep = endpoint({ accessToken: 'login token' })

        await ep.connect()
        await ep.disconnect()

        expect(fake.sockets[0]!.authorization).toBe('Bearer login token')
    })

    test('an expired or invalid login token is raised, not used as is', async () => {
        fake.exchangeAnswers.push(EXPIRED, EXPIRED)
        const ep = endpoint({ accessToken: 'expired login' })

        const connecting = ep.connect()

        await expect(connecting).rejects.toBe(`error Unexpected status 401: ${EXPIRED.body}`)
        expect(fake.upgrades).toBe(0)
    })

    test('a login the compute API forbids for the account is raised', async () => {
        fake.exchangeAnswers.push(FORBIDDEN, FORBIDDEN)
        const ep = endpoint({ accessToken: 'the login token' })

        const connecting = ep.connect()

        await expect(connecting).rejects.toBe(`error Unexpected status 403: ${FORBIDDEN.body}`)
        expect(fake.upgrades).toBe(0)
    })

    test('a failing compute API is raised, not answered with the unexchanged token', async () => {
        const failure = { status: 500, body: 'boom' }
        fake.exchangeAnswers.push(failure, failure)
        const ep = endpoint({ accessToken: 'the login token' })

        const connecting = ep.connect()

        await expect(connecting).rejects.toBe('error Unexpected status 500: boom')
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

    test('parallel calls after expiry share one exchange', async () => {
        fake.expiresIn = 120
        const ep = endpoint({ accessToken: 'the login token' })
        await ep.connect()
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 70_000)

        await Promise.all([ep.session(), ep.session(), ep.session(), ep.session()])
        await ep.disconnect()

        expect(fake.exchanges).toHaveLength(2)
    })

    test('a 401 for a token that was already replaced keeps the new token', async () => {
        const ep = endpoint({ accessToken: 'the login token' })
        await ep.connect()
        const rejected = (ep as any).statusHandler401.bind(ep)

        rejected(401, 'minted-0')
        await ep.session()
        expect(fake.exchanges).toHaveLength(1)
        rejected(401, 'minted-1')
        await ep.session()
        await ep.disconnect()

        expect(fake.exchanges).toHaveLength(2)
    })

    test('a browser login is exchanged, and exchanged again when expires_in has passed', async () => {
        fake.expiresIn = 120
        const login = jest.mocked(authenticateBrowserSession)
        login.mockResolvedValue({ eyepopUrl: fake.url, accessToken: 'the browser login', validUntil: Date.now() + 3_600_000 })
        const ep = endpoint({ oAuth2: true })
        await ep.connect()
        const connected = Date.now()

        jest.spyOn(Date, 'now').mockReturnValue(connected + 70_000)
        await ep.session()
        await ep.disconnect()

        expect(fake.exchanges).toEqual(['Bearer the browser login', 'Bearer the browser login'])
        expect(login).toHaveBeenCalledTimes(2)
        expect(fake.sockets[0]!.authorization).toBe('Bearer minted-1')
    })
})
