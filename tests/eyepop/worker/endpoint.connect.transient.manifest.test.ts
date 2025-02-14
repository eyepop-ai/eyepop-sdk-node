import { EyePop, ModelFormat, ModelInstanceDef, ModelPrecisionType, SourcesEntry, TransientPopId, Pop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

import { pino } from 'pino'

describe('EyePopSdk endpoint module auth and connect for transient popId', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    const test_pop_id = TransientPopId.Transient
    const test_pipeline_id = uuidv4()
    const test_secret_key = uuidv4()
    const test_access_token = uuidv4()
    const test_sandbox_id = uuidv4()
    const short_token_valid_time = 1
    const long_token_valid_time = 1000 * 1000

    const test_manifest: SourcesEntry[] = [
        {
            authority: 'test1',
            manifest: 'http://foo.bar/0.0.0/manifest.json',
        },
        { authority: 'test2', manifest: 'http://fool.bart/0.0.0/manifest.json' },
    ]

    const test_model: ModelInstanceDef = {
        model_id: 'test1:test',
        dataset: 'TestDataset',
        format: ModelFormat.TorchScript,
        type: ModelPrecisionType.float32,
    }

    test('EyePopSdk create sandbox', async () => {
        const authenticationRoute = server.post('/authentication/token').mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: long_token_valid_time,
                token_type: 'Bearer',
            })
        })

        const workerConfigRoute = server.get(`/workers/config`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ base_url: `${server.getURL()}w/` })
        })

        const postSandboxes = server.post(`/w/sandboxes`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify(test_sandbox_id)
        })

        const deleteSandboxes = server.delete(`/w/sandboxes/${test_sandbox_id}`).mockImplementationOnce(ctx => {
            ctx.status = 204
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({})
        })

        const stopRoute = server.patch(`/w/pipelines/${test_pipeline_id}/source`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const sourcesRoute = server.put(`/w/models/sources`).mockImplementationOnce(ctx => {
            ctx.status = 204
        })

        const instancesRoute = server.post(`/w/models/instances`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify(test_model)
        })

        let pop: Pop | null = null
        const startPipelineRoute = server.post(`/w/pipelines`).mockImplementationOnce(ctx => {
            // @ts-ignore
            pop = ctx.request.body['pop']
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
            })
        })

        const getPipelineRoute = server.get(`/w/pipelines/${test_pipeline_id}`).mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                id: test_pipeline_id,
                pop: pop,
            })
        })

        const changePopCompRoute = server.patch(`/w/pipelines/${test_pipeline_id}/pop`).mockImplementationOnce(ctx => {
            // @ts-ignore
            inferPipeline = ctx.request.body['pipeline']
            ctx.status = 204
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: { secretKey: test_secret_key },
            isSandbox: true,
            logger: pino({ level: 'debug' }),
        })

        expect(endpoint).toBeDefined()

        try {
            await endpoint.connect()

            await endpoint.changeManifest(test_manifest)

            await endpoint.loadModel(test_model)

            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(workerConfigRoute).toHaveBeenCalledTimes(1)
            expect(postSandboxes).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
            expect(sourcesRoute).toHaveBeenCalledTimes(1)
            expect(instancesRoute).toHaveBeenCalledTimes(1)
        } finally {
            await endpoint.disconnect()
        }
    })
})
