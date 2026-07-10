import { describe, expect, test } from '@jest/globals'

import { ComputeSessionClient, SessionStatus } from '../../../src/eyepop/compute/compute_session'
import type { HttpClient } from '../../../src/eyepop/options'
import { PopComponentType, type Pop } from '../../../src/eyepop'

const computeUrl = 'https://compute.example.test'
const sessionEndpoint = 'https://worker.example.test/session'
const accessToken = 'session-token'

function sessionResponse(pipelineId?: string) {
    return [
        {
            session_uuid: 'session-uuid',
            session_endpoint: sessionEndpoint,
            pipeline_uuid: pipelineId || '',
            access_token: accessToken,
            access_token_expires_in: 60,
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

function createHttpClient(calls: FetchCall[], pipelineId?: string): HttpClient {
    return {
        async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const url = input.toString()
            calls.push({ url, init })
            if (url === `${computeUrl}/v1/sessions`) {
                return new Response('not found', { status: 404 })
            }
            if (url.startsWith(`${computeUrl}/v1/sessions?`)) {
                return new Response(JSON.stringify(sessionResponse(pipelineId)), {
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

    test('creates no-pop on-demand sessions as transient sessions', async () => {
        const calls: FetchCall[] = []

        await new ComputeSessionClient({
            computeUrl,
            httpClient: createHttpClient(calls),
            authorizationHeader,
            readyTimeoutMs,
        }).resolve()

        const createCall = calls.find(call => call.init?.method === 'POST')
        expect(createCall?.url).toBe(`${computeUrl}/v1/sessions?wait=true&transient=true`)
    })

    test('creates constructor-pop sessions as transient sessions', async () => {
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
        expect(createCall?.url).toBe(`${computeUrl}/v1/sessions?wait=true&transient=true`)
        expect(JSON.parse(String(createCall?.init?.body))).toEqual({ pop })
    })
})
