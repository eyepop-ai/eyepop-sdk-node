import { PipelineManagedError } from '../../../src/eyepop/worker/session_backend'
import { WorkerEndpoint } from '../../../src/eyepop/worker/worker_endpoint'
import { PopComponentType, type Pop } from '../../../src/eyepop/worker/worker_types'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

// these tests cover worker session mode; pipeline mode is the default
process.env['EYEPOP_PIPELINE_MODE'] = 'false'

describe('EyePopSdk changePop on a persistent session attached by uuid', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    const test_api_key = uuidv4()
    const test_access_token = uuidv4()
    const test_pop: Pop = {
        components: [
            {
                type: PopComponentType.INFERENCE,
                ability: 'eyepop.person:latest',
            },
        ],
    }

    function persistentSession(sessionUuid: string, pipelines: string[]) {
        server.get(`/v1/sessions/${sessionUuid}`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                session_uuid: sessionUuid,
                session_endpoint: `${server.getURL().toString()}${sessionUuid}`,
                access_token: test_access_token,
                access_token_expires_in: 1000 * 1000,
                pipeline_uuid: '',
                pipelines: pipelines.map(id => ({ pipeline_id: id })),
                session_status: 'running',
                session_active: true,
                persistent: true,
            })
        })
        server.get(`/${sessionUuid}/health`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = "I'm fine"
        })
    }

    const endpointFor = (sessionUuid: string) =>
        new WorkerEndpoint({
            eyepopUrl: server.getURL().toString(),
            sessionUuid: sessionUuid,
            auth: { apiKey: test_api_key },
        })

    test('a 2xx changes the pop of the session pipeline', async () => {
        const sessionUuid = uuidv4()
        const pipelineId = uuidv4()
        persistentSession(sessionUuid, [pipelineId])
        let patchBody: any = null
        const patchPopRoute = server.patch(`/${sessionUuid}/pipelines/${pipelineId}/pop`).mockImplementationOnce(ctx => {
            patchBody = (ctx.request as any).body
            ctx.status = 204
        })

        const endpoint = endpointFor(sessionUuid)
        try {
            await endpoint.connect()
            await endpoint.changePop(test_pop)
            expect(patchPopRoute).toHaveBeenCalledTimes(1)
            expect(patchBody).toEqual(test_pop)
            expect(endpoint.pop()).toEqual(test_pop)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a 409 throws PipelineManagedError with the pipeline, the session and the server reason, without a retry', async () => {
        const sessionUuid = uuidv4()
        const pipelineId = uuidv4()
        persistentSession(sessionUuid, [pipelineId])
        const patchPopRoute = server.patch(`/${sessionUuid}/pipelines/${pipelineId}/pop`).mockImplementation(ctx => {
            ctx.status = 409
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ error: 'declared_pipeline', reason: 'processor', message: 'the processor p1 runs this pipeline' })
        })

        const endpoint = endpointFor(sessionUuid)
        try {
            await endpoint.connect()
            const refusal = await endpoint.changePop(test_pop).then(
                () => null,
                error => error,
            )
            expect(refusal).toBeInstanceOf(PipelineManagedError)
            expect(refusal).toMatchObject({
                status: 409,
                pipelineId: pipelineId,
                sessionUuid: sessionUuid,
                error: 'declared_pipeline',
                reason: 'processor',
                serverMessage: 'the processor p1 runs this pipeline',
            })
            expect(refusal.message).toContain(`the pipeline ${pipelineId} of session ${sessionUuid} is managed by the session's declaration (a declared stream or processor)`)
            expect(refusal.message).toContain('change the declaration instead')
            expect(refusal.message).toContain('declared_pipeline: processor: the processor p1 runs this pipeline')
            expect(patchPopRoute).toHaveBeenCalledTimes(1)
            expect(endpoint.pop()).toBeNull()
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a 409 with a body that is not JSON keeps the body as the server message', async () => {
        const sessionUuid = uuidv4()
        const pipelineId = uuidv4()
        persistentSession(sessionUuid, [pipelineId])
        server.patch(`/${sessionUuid}/pipelines/${pipelineId}/pop`).mockImplementation(ctx => {
            ctx.status = 409
            ctx.response.headers['content-type'] = 'text/plain'
            ctx.body = 'conflict'
        })

        const endpoint = endpointFor(sessionUuid)
        try {
            await endpoint.connect()
            const refusal = await endpoint.changePop(test_pop).then(
                () => null,
                error => error,
            )
            expect(refusal).toBeInstanceOf(PipelineManagedError)
            expect(refusal).toMatchObject({ pipelineId, sessionUuid, error: undefined, serverMessage: 'conflict' })
            expect(refusal.message).toContain('(409 conflict)')
        } finally {
            await endpoint.disconnect()
        }
    })

    test('a pop_fixed 409 says the session fixes its pop', async () => {
        const sessionUuid = uuidv4()
        const pipelineId = uuidv4()
        persistentSession(sessionUuid, [pipelineId])
        server.patch(`/${sessionUuid}/pipelines/${pipelineId}/pop`).mockImplementation(ctx => {
            ctx.status = 409
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ error: 'pop_fixed' })
        })

        const endpoint = endpointFor(sessionUuid)
        try {
            await endpoint.connect()
            const refusal = await endpoint.changePop(test_pop).then(
                () => null,
                error => error,
            )
            expect(refusal).toBeInstanceOf(PipelineManagedError)
            expect(refusal).toMatchObject({ error: 'pop_fixed', pipelineId, sessionUuid })
            expect(refusal.message).toContain(`the pipeline ${pipelineId} of session ${sessionUuid} runs the session's fixed pop`)
        } finally {
            await endpoint.disconnect()
        }
    })

    test('the session pipeline is the first one its agent does not own', async () => {
        const sessionUuid = uuidv4()
        const bootPipelineId = uuidv4()
        persistentSession(sessionUuid, ['agent-front-door-detect', 'agent-processor-p1', bootPipelineId])
        const patchPopRoute = server.patch(`/${sessionUuid}/pipelines/${bootPipelineId}/pop`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const endpoint = endpointFor(sessionUuid)
        try {
            await endpoint.connect()
            expect((await endpoint.session()).pipelineId).toEqual(bootPipelineId)
            await endpoint.changePop(test_pop)
            expect(patchPopRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })
})
