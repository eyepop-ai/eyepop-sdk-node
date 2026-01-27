import { EyePop, PopComponentType, TransientPopId, Pop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

describe('EyePopSdk endpoint module auth and connect for transient popId', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    const test_pop_id = TransientPopId.Transient
    const test_session_uuid = uuidv4().toString()
    const test_pipeline_id = uuidv4()
    const test_api_key = uuidv4()
    const test_access_token = uuidv4()
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

        const listSessionsRoute = server.get(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 404
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify("no sessions")
        })

        const createSessionRoute = server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([{
                session_uuid: test_session_uuid,
                session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                pipeline_uuid: uuidv4().toString(),
                session_status: "running",
                session_active: true
            }])
        })

        const healthRoute = server.get(`/${test_session_uuid}/health`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        const startPipelineRoute = server.post(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const stopRoute = server.delete(`/${test_session_uuid}/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
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
            expect(healthRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
            expect(stopRoute).toHaveBeenCalledTimes(1)
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
            ctx.body = JSON.stringify([{
                session_uuid: test_session_uuid,
                session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                pipeline_uuid: uuidv4().toString(),
                session_status: "running",
                session_active: true
            }])
        })

        const healthRoute = server.get(`/${test_session_uuid}/health`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })


        let pop: Pop | null = null
        const startPipelineRoute = server.post(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            // @ts-ignore
            pop = ctx.request.body['pop']
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const stopRoute = server.delete(`/${test_session_uuid}/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const changePopRoute = server.patch(`/${test_session_uuid}/pipelines/${test_pipeline_id}/pop`).mockImplementationOnce(ctx => {
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
            expect(healthRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(1)

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
            expect(stopRoute).toHaveBeenCalledTimes(1)
        }
    })
})
