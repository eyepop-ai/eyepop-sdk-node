import { EyePop, PopComponentType, TransientPopId, Pop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import {PipelineStatus} from "EyePop/worker/worker_endpoint";

describe('EyePopSdk endpoint module auth and connect for transient popId', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    const test_pop_id = TransientPopId.Transient
    const test_pipeline_id = uuidv4()
    const test_api_key = uuidv4()
    const test_access_token = uuidv4()
    const short_token_valid_time = 1
    const long_token_valid_time = 1000 * 1000

    test('EyePopSdk connect transient', async () => {
        const authenticationRoute = server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        const popConfigRoute = server.get(`/workers/config`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/` })
        })

        const stopRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const startPipelineRoute = server.post(`/worker/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const getPipelineRoute = server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: { apiKey: test_api_key },
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
            expect(getPipelineRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk changePop transient', async () => {
        const authenticationRoute = server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        const listSessionsRoute = server.get(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 404
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify("no sessions")
        })

        const createSessionRoute = server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            const sessionUuid = uuidv4().toString()
            ctx.body = JSON.stringify([{
                session_uuid: sessionUuid,
                session_endpoint: `${server.getURL().toString()}/${sessionUuid}`,
                pipeline_uuid: uuidv4().toString(),
                session_status: PipelineStatus.RUNNING,
                session_active: true
            }])
        })

        const stopRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        let pop: Pop | null = null
        const startPipelineRoute = server.post(`/worker/pipelines`).mockImplementationOnce(ctx => {
            // @ts-ignore
            pop = ctx.request.body['pop']
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const getPipelineRoute = server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
                inferPipeline: 'identity',
            })
        })

        const changePopRoute = server.patch(`/worker/pipelines/${test_pipeline_id}/pop`).mockImplementationOnce(ctx => {
            // @ts-ignore
            pop = ctx.request.body
            ctx.status = 204
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: { apiKey: test_api_key },
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(listSessionsRoute).toHaveBeenCalledTimes(1)
            expect(createSessionRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
            expect(getPipelineRoute).toHaveBeenCalledTimes(1)

            let pop = await endpoint.pop()
            expect(pop).toBeNull()

            await endpoint.changePop({
                components: [
                    {
                        type: PopComponentType.FORWARD,
                    },
                ],
            })
            pop = endpoint.pop()
            expect(pop).toEqual({
                components: [
                    {
                        type: PopComponentType.FORWARD,
                    },
                ],
            })
            expect(changePopRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })
})
