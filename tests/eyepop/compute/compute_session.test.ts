import { describe, expect, test } from '@jest/globals'

import { ComputeSessionClient, SessionStatus } from '../../../src/eyepop/compute/compute_session'
import type { HttpClient } from '../../../src/eyepop/options'
import { PopComponentType, type Pop } from '../../../src/eyepop/worker/worker_types'

const computeUrl = 'https://compute.example.test'
const sessionEndpoint = 'https://worker.example.test/session'
const accessToken = 'session-token'

function sessionResponse(pipelineId?: string, includeAccessToken = true) {
    return [
        {
            session_uuid: 'session-uuid',
            session_endpoint: sessionEndpoint,
            pipeline_uuid: pipelineId || '',
            ...(includeAccessToken ? { access_token: accessToken, access_token_expires_in: 60 } : {}),
            session_status: SessionStatus.RUNNING,
            session_message: '',
            session_name: 'node-sdk-test',
            user_uuid: 'user-uuid',
            created_at: new Date(0).toISOString(),
            uptime: 0,
            session_active: true,
            persistent: false,
            pipelines: pipelineId ? [{ pipeline_id: pipelineId }] : [],
        },
    ]
}

type FetchCall = { url: string; init: RequestInit | undefined }

function createHttpClient(calls: FetchCall[], pipelineId?: string, includeAccessToken = true): HttpClient {
    return {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const url = input.toString()
            calls.push({ url, init })
            if (url === `${computeUrl}/v1/sessions`) {
                return new Response('not found', { status: 404 })
            }
            if (url.startsWith(`${computeUrl}/v1/sessions?`)) {
                return new Response(JSON.stringify(sessionResponse(pipelineId, includeAccessToken)), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
            }
            if (url === `${sessionEndpoint}/health`) {
                return new Response("I'm fine", {
                    status: 200,
                    headers: { 'content-type': 'text/plain' },
                })
            }
            return new Response(`unexpected url ${url}`, { status: 500 })
        },
        async close(): Promise<void> {},
        isFullDuplex(): boolean {
            return false
        },
    }
}

describe('ComputeSessionClient', () => {
    const authorizationHeader = async () => 'Bearer api-key'
    const readyTimeoutMs = 1000

    test('creates no-pop on-demand sessions with wait', async () => {
        const calls: FetchCall[] = []

        await new ComputeSessionClient({
            computeUrl,
            httpClient: createHttpClient(calls),
            authorizationHeader,
            readyTimeoutMs,
        }).resolve()

        const createCall = calls.find(call => call.init?.method === 'POST')
        expect(createCall?.url).toBe(`${computeUrl}/v1/sessions?wait=true`)
    })

    test('creates constructor-pop sessions with wait', async () => {
        const calls: FetchCall[] = []
        const pop: Pop = {
            components: [
                {
                    type: PopComponentType.INFERENCE,
                    ability: 'eyepop.localize-objects:latest',
                    categoryName: 'objects',
                    params: { prompts: [{ prompt: 'person' }] },
                },
            ],
        }

        await new ComputeSessionClient({
            computeUrl,
            httpClient: createHttpClient(calls, 'pipeline-uuid'),
            authorizationHeader,
            readyTimeoutMs,
            pop,
        }).resolve()

        const createCall = calls.find(call => call.init?.method === 'POST')
        expect(createCall?.url).toBe(`${computeUrl}/v1/sessions?wait=true`)
        expect(JSON.parse(String(createCall?.init?.body))).toEqual({ pop })
    })

    test('names the account in the session-creation body when accountId is set', async () => {
        const calls: FetchCall[] = []

        await new ComputeSessionClient({
            computeUrl,
            httpClient: createHttpClient(calls),
            authorizationHeader,
            readyTimeoutMs,
            accountId: 'account-uuid',
        }).resolve()

        const createCall = calls.find(call => call.init?.method === 'POST')
        expect(createCall?.url).toBe(`${computeUrl}/v1/sessions?wait=true`)
        expect(createCall?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
        expect(JSON.parse(String(createCall?.init?.body))).toEqual({ account_uuid: 'account-uuid' })
    })

    test('omits account_uuid from the session-creation body when accountId is not set', async () => {
        const calls: FetchCall[] = []

        await new ComputeSessionClient({
            computeUrl,
            httpClient: createHttpClient(calls),
            authorizationHeader,
            readyTimeoutMs,
            sessionName: 'named-session',
        }).resolve()

        const createCall = calls.find(call => call.init?.method === 'POST')
        const body = JSON.parse(String(createCall?.init?.body))
        expect(body).toEqual({ session_name: 'named-session' })
        expect(body).not.toHaveProperty('account_uuid')
    })

    test('uses caller authorization when compute session has no access token', async () => {
        const calls: FetchCall[] = []
        const callerAuthorizationHeader = 'Bearer user-jwt'

        const resolved = await new ComputeSessionClient({
            computeUrl,
            httpClient: createHttpClient(calls, undefined, false),
            authorizationHeader: async () => callerAuthorizationHeader,
            readyTimeoutMs,
        }).resolve()

        const healthCall = calls.find(call => call.url === `${sessionEndpoint}/health`)
        expect(healthCall?.init?.headers).toMatchObject({
            Authorization: callerAuthorizationHeader,
            Accept: 'application/json',
        })
        expect(resolved.accessToken).toBeNull()
        expect(resolved.accessTokenValidUntil).toBeNull()
    })

    test('refuses a session picked by uuid that runs under another account', async () => {
        const httpClient: HttpClient = {
            async fetch(input: RequestInfo | URL): Promise<Response> {
                if (input.toString() === `${computeUrl}/v1/sessions/session-uuid`) {
                    return new Response(JSON.stringify({ ...sessionResponse()[0], account_uuid: 'other-account-uuid' }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    })
                }
                return new Response(`unexpected url ${input.toString()}`, { status: 500 })
            },
            async close(): Promise<void> {},
            isFullDuplex(): boolean {
                return false
            },
        }

        await expect(
            new ComputeSessionClient({
                computeUrl,
                httpClient,
                authorizationHeader,
                readyTimeoutMs,
                sessionUuid: 'session-uuid',
                accountId: 'account-uuid',
            }).resolve(),
        ).rejects.toMatchObject({
            name: 'ComputeAccountMismatchError',
            sessionAccountId: 'other-account-uuid',
            accountId: 'account-uuid',
        })
    })
})
