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
    const test_transient_pop: Pop = {
        components: [
            {
                type: PopComponentType.INFERENCE,
                ability: 'eyepop.vlm.preview:latest',
                categoryName: 'answer',
            },
        ],
    }

    test('EyePopSdk connect transient without a pop does not create an empty pipeline', async () => {
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
            ctx.body = JSON.stringify('no sessions')
        })

        const createSessionRoute = server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: test_session_uuid,
                    session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [],
                    session_status: 'running',
                    session_active: true,
                },
            ])
        })

        const healthRoute = server.get(`/${test_session_uuid}/health`).mockImplementation(ctx => {
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

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: { apiKey: test_api_key },
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(0)
            expect(listSessionsRoute).toHaveBeenCalledTimes(1)
            expect(createSessionRoute).toHaveBeenCalledTimes(1)
            expect(healthRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk connect transient reports compute pipeline errors', async () => {
        server.get(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 404
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify('no sessions')
        })

        server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 400
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                code: 'SESS_007',
                message: 'Invalid pipeline configuration',
                details: 'no element "Glasses"',
            })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            auth: { apiKey: test_api_key },
        })

        await expect(endpoint.connect()).rejects.toThrow('SESS_007: Invalid pipeline configuration: no element "Glasses"')
    })

    test('EyePopSdk connect transient reports session pipeline errors', async () => {
        server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: test_session_uuid,
                    session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [],
                    session_status: 'pipeline_error',
                    session_active: true,
                    pipeline_error: {
                        code: 'PIPELINE_001',
                        message: 'Pipeline failed',
                        details: 'no element "Glasses"',
                    },
                },
            ])
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            auth: { apiKey: test_api_key },
        })

        await expect(endpoint.connect()).rejects.toThrow(`Pipeline failed for compute session ${test_session_uuid}: PIPELINE_001: Pipeline failed: no element "Glasses"`)
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
            ctx.body = JSON.stringify('no sessions')
        })

        let changePopCreateBody: any = null
        const createSessionRoute = server
            .post(`/v1/sessions`)
            .mockImplementationOnce(ctx => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: test_session_uuid,
                        session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                        access_token: test_access_token,
                        access_token_expires_in: long_token_valid_time,
                        pipelines: [],
                        session_status: 'running',
                        session_active: true,
                    },
                ])
            })
            .mockImplementationOnce(ctx => {
                changePopCreateBody = (ctx.request as any).body
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: test_session_uuid,
                        session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                        access_token: test_access_token,
                        access_token_expires_in: long_token_valid_time,
                        pipelines: [{ pipeline_id: test_pipeline_id }],
                        session_status: 'running',
                        session_active: true,
                    },
                ])
            })

        const healthRoute = server.get(`/${test_session_uuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        const startPipelineRoute = server.post(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: uuidv4(),
            })
        })

        const stopInitialPipelineRoute = server.delete(`/${test_session_uuid}/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const patchPopRoute = server.patch(`/${test_session_uuid}/pipelines/${test_pipeline_id}/pop`).mockImplementationOnce(ctx => {
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
            expect(authenticationRoute).toHaveBeenCalledTimes(0)
            expect(listSessionsRoute).toHaveBeenCalledTimes(1)
            expect(createSessionRoute).toHaveBeenCalledTimes(1)
            expect(healthRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)

            let pop = await endpoint.pop()
            expect(pop).toBeNull()

            await endpoint.changePop(test_transient_pop)
            pop = endpoint.pop()
            const session = await endpoint.session()
            expect(pop).toEqual(test_transient_pop)
            expect(session.pipelineId).toEqual(test_pipeline_id)
            expect(changePopCreateBody).toEqual({ pop: test_transient_pop })
            expect(stopInitialPipelineRoute).toHaveBeenCalledTimes(0)
            expect(createSessionRoute).toHaveBeenCalledTimes(2)
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)
            expect(patchPopRoute).toHaveBeenCalledTimes(0)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk changePop transient continues when stale pipeline delete fails', async () => {
        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        server.get(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 404
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify('no sessions')
        })

        const replacementPipelineId = uuidv4()
        const createSessionRoute = server
            .post(`/v1/sessions`)
            .mockImplementationOnce(ctx => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: test_session_uuid,
                        session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                        access_token: test_access_token,
                        access_token_expires_in: long_token_valid_time,
                        pipeline_uuid: test_pipeline_id,
                        session_status: 'running',
                        session_active: true,
                    },
                ])
            })
            .mockImplementationOnce(ctx => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: test_session_uuid,
                        session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                        access_token: test_access_token,
                        access_token_expires_in: long_token_valid_time,
                        pipeline_uuid: replacementPipelineId,
                        session_status: 'running',
                        session_active: true,
                    },
                ])
            })

        server.get(`/${test_session_uuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        const startPipelineRoute = server.post(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: replacementPipelineId,
            })
        })

        const failedDeleteRoute = server.delete(`/${test_session_uuid}/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
            ctx.status = 500
            ctx.body = 'cleanup failed'
        })

        server.delete(`/${test_session_uuid}/pipelines/${replacementPipelineId}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: { apiKey: test_api_key },
        })

        try {
            await endpoint.connect()
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)
            await endpoint.changePop(test_transient_pop)
            const session = await endpoint.session()
            expect(endpoint.pop()).toEqual(test_transient_pop)
            expect(session.pipelineId).toEqual(replacementPipelineId)
            expect(failedDeleteRoute).toHaveBeenCalledTimes(1)
            expect(createSessionRoute).toHaveBeenCalledTimes(2)
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk changePop transient clears deleted pipeline and restores token when replacement session fails', async () => {
        const initialSessionUuid = uuidv4().toString()
        const replacementSessionUuid = uuidv4().toString()
        const initialPipelineId = uuidv4()
        const replacementPipelineId = uuidv4()
        const recoveryPipelineId = uuidv4()
        const initialAccessToken = uuidv4()
        const replacementAccessToken = uuidv4()
        const replacementPop: Pop = {
            components: [
                {
                    type: PopComponentType.INFERENCE,
                    ability: 'eyepop.person:latest',
                    categoryName: 'person',
                },
            ],
        }

        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        const createSessionRoute = server
            .post(`/v1/sessions`)
            .mockImplementationOnce(ctx => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: initialSessionUuid,
                        session_endpoint: `${server.getURL().toString()}${initialSessionUuid}`,
                        access_token: initialAccessToken,
                        access_token_expires_in: long_token_valid_time,
                        pipeline_uuid: initialPipelineId,
                        session_status: 'running',
                        session_active: true,
                    },
                ])
            })
            .mockImplementationOnce(ctx => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: replacementSessionUuid,
                        session_endpoint: `${server.getURL().toString()}${replacementSessionUuid}`,
                        access_token: replacementAccessToken,
                        access_token_expires_in: long_token_valid_time,
                        pipeline_uuid: replacementPipelineId,
                        session_status: 'pipeline_creating',
                        session_active: true,
                    },
                ])
            })
            .mockImplementationOnce(ctx => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify([
                    {
                        session_uuid: initialSessionUuid,
                        session_endpoint: `${server.getURL().toString()}${initialSessionUuid}`,
                        access_token: initialAccessToken,
                        access_token_expires_in: long_token_valid_time,
                        pipeline_uuid: recoveryPipelineId,
                        session_status: 'running',
                        session_active: true,
                    },
                ])
            })

        server.get(`/${initialSessionUuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        const replacementHealthRoute = server.get(`/${replacementSessionUuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                session_status: 'pipeline_creating',
            })
        })

        const deleteInitialPipelineRoute = server.delete(`/${initialSessionUuid}/pipelines/${initialPipelineId}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const startPipelineRoute = server.post(`/${initialSessionUuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: uuidv4(),
            })
        })

        const sourceRoute = server.patch(`/${initialSessionUuid}/pipelines/${recoveryPipelineId}/source`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/jsonl'
            ctx.body = JSON.stringify({ objects: [] }) + '\n'
        })

        server.delete(`/${initialSessionUuid}/pipelines/${recoveryPipelineId}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            sessionReadyTimeoutSeconds: 0.001,
            auth: { apiKey: test_api_key },
        })

        try {
            await endpoint.connect()
            expect((endpoint as any)._pipelineId).toEqual(initialPipelineId)
            expect((endpoint as any)._sessionAccessToken).toEqual(initialAccessToken)

            await expect(endpoint.changePop(replacementPop)).rejects.toThrow(`Created session ${replacementSessionUuid} did not become healthy after 0.001 seconds`)

            expect(endpoint.pop()).toEqual(test_transient_pop)
            expect((endpoint as any)._baseUrl).toBeNull()
            expect((endpoint as any)._pipeline).toBeNull()
            expect((endpoint as any)._pipelineId).toBeNull()
            expect((endpoint as any)._sessionAccessToken).toEqual(initialAccessToken)
            expect(deleteInitialPipelineRoute).toHaveBeenCalledTimes(1)
            expect(createSessionRoute).toHaveBeenCalledTimes(2)
            expect(replacementHealthRoute).toHaveBeenCalled()

            const stream = await endpoint.process({ source: { url: 'https://example.com/cat.jpg' } })
            const predictions = []
            for await (const prediction of stream) {
                predictions.push(prediction)
            }

            expect(predictions).toHaveLength(1)
            expect((endpoint as any)._baseUrl).toEqual(`${server.getURL().toString()}${initialSessionUuid}`)
            expect((endpoint as any)._pipelineId).toEqual(recoveryPipelineId)
            expect(createSessionRoute).toHaveBeenCalledTimes(3)
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)
            expect(sourceRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk only reuses a transient session with the configured session name', async () => {
        const existingSessionUuid = uuidv4().toString()
        const createdSessionUuid = uuidv4().toString()
        const createdPipelineId = uuidv4()

        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        const listSessionsRoute = server.get(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: existingSessionUuid,
                    session_endpoint: `${server.getURL().toString()}${existingSessionUuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipeline_uuid: uuidv4(),
                    session_status: 'running',
                    session_active: true,
                    session_name: 'other-smoke-scenario',
                    persistent: false,
                },
            ])
        })

        const createSessionRoute = server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: createdSessionUuid,
                    session_endpoint: `${server.getURL().toString()}${createdSessionUuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipeline_uuid: createdPipelineId,
                    session_status: 'running',
                    session_active: true,
                    session_name: 'target-smoke-scenario',
                    persistent: false,
                },
            ])
        })

        server.get(`/${createdSessionUuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        server.delete(`/${createdSessionUuid}/pipelines/${createdPipelineId}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            sessionName: 'target-smoke-scenario',
            auth: { apiKey: test_api_key },
        })

        try {
            await endpoint.connect()
            const session = await endpoint.session()
            expect(session.pipelineId).toEqual(createdPipelineId)
            expect(listSessionsRoute).toHaveBeenCalledTimes(1)
            expect(createSessionRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk sends constructor pop to compute and uses returned transient pipeline', async () => {
        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        const listSessionsRoute = server.get(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: uuidv4().toString(),
                    session_endpoint: `${server.getURL().toString()}old-session`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [{ pipeline_id: uuidv4().toString() }],
                    session_status: 'running',
                    session_active: true,
                    persistent: false,
                },
            ])
        })

        let createBody: any = null
        const createSessionRoute = server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            // @ts-ignore
            createBody = ctx.request.body
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: test_session_uuid,
                    session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [{ pipeline_id: test_pipeline_id }],
                    session_status: 'running',
                    session_active: true,
                },
            ])
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
                id: uuidv4(),
            })
        })

        const stopRoute = server.delete(`/${test_session_uuid}/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            sessionName: 'node-cpu-session',
            pipelineImage: 'pipeline-image',
            pipelineVersion: 'pipeline-version',
            auth: { apiKey: test_api_key },
        })

        try {
            await endpoint.connect()
            const session = await endpoint.session()
            expect(session.pipelineId).toEqual(test_pipeline_id)
            expect(endpoint.pop()).toEqual(test_transient_pop)
            expect(listSessionsRoute).toHaveBeenCalledTimes(0)
            expect(createSessionRoute).toHaveBeenCalledTimes(1)
            expect(healthRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(0)
            expect(createBody).toEqual({
                pop: test_transient_pop,
                session_name: 'node-cpu-session',
                pipeline_image: 'pipeline-image',
                pipeline_version: 'pipeline-version',
            })
        } finally {
            await endpoint.disconnect()
            expect(stopRoute).toHaveBeenCalledTimes(1)
        }
    })

    test('EyePopSdk uses configured session ready timeout for compute health', async () => {
        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: test_session_uuid,
                    session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [{ pipeline_id: test_pipeline_id }],
                    session_status: 'pipeline_creating',
                    session_active: true,
                },
            ])
        })

        const healthRoute = server.get(`/${test_session_uuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                session_status: 'pipeline_creating',
            })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            sessionReadyTimeoutSeconds: 0.001,
            auth: { apiKey: test_api_key },
        })

        await expect(endpoint.connect()).rejects.toThrow(`Created session ${test_session_uuid} did not become healthy after 0.001 seconds`)
        expect(healthRoute).toHaveBeenCalled()
    })

    test('EyePopSdk rejects constructor pop when compute returns no pipeline', async () => {
        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: test_session_uuid,
                    session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [],
                    session_status: 'pipeline_creating',
                    session_active: true,
                },
            ])
        })

        server.get(`/${test_session_uuid}/health`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        const pollSessionRoute = server.get(`/v1/sessions/${test_session_uuid}`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                session_uuid: test_session_uuid,
                session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                pipelines: [{ pipeline_id: test_pipeline_id }],
                session_status: 'running',
                session_active: true,
            })
        })

        const listPipelinesRoute = server.get(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([])
        })

        const startPipelineRoute = server.post(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            auth: { apiKey: test_api_key },
        })

        await expect(endpoint.connect()).rejects.toThrow('Compute session did not provide a pipeline for the requested pop')
        expect(pollSessionRoute).toHaveBeenCalledTimes(0)
        expect(listPipelinesRoute).toHaveBeenCalledTimes(0)
        expect(startPipelineRoute).toHaveBeenCalledTimes(0)
    })

    test('EyePopSdk does not poll compute detail when compute returns no constructor pop pipeline', async () => {
        server.post('/v1/auth/authenticate').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        server.post(`/v1/sessions`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    session_uuid: test_session_uuid,
                    session_endpoint: `${server.getURL().toString()}${test_session_uuid}`,
                    access_token: test_access_token,
                    access_token_expires_in: long_token_valid_time,
                    pipelines: [],
                    session_status: 'pipeline_creating',
                    session_active: true,
                },
            ])
        })

        server.get(`/${test_session_uuid}/health`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })

        const pollSessionRoute = server.get(`/v1/sessions/${test_session_uuid}`).mockImplementationOnce(ctx => {
            ctx.status = 404
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                error: {
                    code: 'RES_001',
                    type: 'resource',
                    message: `session "${test_session_uuid}" not found`,
                    retryable: false,
                },
            })
        })

        const listPipelinesRoute = server.get(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify([
                {
                    id: test_pipeline_id,
                },
            ])
        })

        const startPipelineRoute = server.post(`/${test_session_uuid}/pipelines`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            pop: test_transient_pop,
            auth: { apiKey: test_api_key },
        })

        await expect(endpoint.connect()).rejects.toThrow('Compute session did not provide a pipeline for the requested pop')
        expect(endpoint.pop()).toEqual(test_transient_pop)
        expect(pollSessionRoute).toHaveBeenCalledTimes(0)
        expect(listPipelinesRoute).toHaveBeenCalledTimes(0)
        expect(startPipelineRoute).toHaveBeenCalledTimes(0)
    })
})
