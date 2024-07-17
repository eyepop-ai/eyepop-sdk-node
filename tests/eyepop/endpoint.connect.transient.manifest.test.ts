import { EyePop, Session } from '../../src/eyepop/dist/eyepop.index'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import { TransientPopId } from "../../src/eyepop/options";

import { pino } from 'pino'

describe('EyePopSdk endpoint module auth and connect for transient popId', () =>
{
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

    const test_manifest = JSON.parse(JSON.stringify(
        [
            { "authority": "legacy", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/legacy/1.2.0/manifest.json" },
            { "authority": "Mediapipe", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/Mediapipe/1.3.0/manifest.json" },
            { "authority": "yolov5", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov5/1.0.2/manifest.json" },
            { "authority": "yolov7", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov7/1.0.1/manifest.json" },
            { "authority": "yolov8", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov8/1.0.1/manifest.json" },
            { "authority": "PARSeq", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/PARSeq/1.0.1/manifest.json" },
            { "authority": "mobilenet", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/mobilenet/1.0.1/manifest.json" },
            { "authority": "eyepop-person", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epperson/1.0.2/manifest.json" },
            { "authority": "eyepop-animal", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epanimal/1.0.2/manifest.json" },
            { "authority": "eyepop-device", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epdevice/1.0.2/manifest.json" },
            { "authority": "eyepop-sports", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epsports/1.0.2/manifest.json" },
            { "authority": "eyepop-vehicle", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epvehicle/1.0.2/manifest.json" },
            { "authority": "eyepop-coco", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epcoco/1.0.2/manifest.json" },
            { "authority": "eyepop-age", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epage/0.2.0/manifest.json" },
            { "authority": "eyepop-gender", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epgender/0.2.0/manifest.json" },
            { "authority": "eyepop-expression", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epexpression/0.2.0/manifest.json" },
            { "authority": "PARSeq", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/PARSeq/1.0.2/manifest.json" },
            { "authority": "eyepop-text", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/eptext/1.0.3/manifest.json" },
        ], null, 4
    ));

    const test_model = JSON.parse(JSON.stringify({
        'model_id': 'PARSeq:PARSeq',
        'dataset': 'TextDataset',
        'format': 'TorchScriptCuda',
        'type': 'float32'
    }, null, 4));


    test('EyePopSdk create sandbox', async () =>
    {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementationOnce((ctx) =>
            {
                ctx.status = 200
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const popConfigRoute = server
            .get(`/workers/config`)
            .mockImplementationOnce((ctx) =>
            {
                ctx.status = 200
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/` })
            })


        const postSandboxes = server
            .post(`/worker/sandboxes`)
            .mockImplementationOnce((ctx) =>
            {
                ctx.status = 200
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify({
                    sandboxId: test_sandbox_id
                })
            })

        const deleteSandboxes = server
            .delete(`/worker/sandboxes/${test_sandbox_id}`)
            .mockImplementationOnce((ctx) =>
            {
                ctx.status = 204
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify({});
            })

        const stopRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementationOnce((ctx) =>
            {
                ctx.status = 204
            })

        const sourcesRoute = server
            .put(`/worker/models/sources`)
            .mockImplementationOnce((ctx) =>
            {
                console.log(ctx.request.body);
                ctx.status = 204;
            });

        const instancesRoute = server
            .post(`/worker/models/instances`)
            .mockImplementationOnce((ctx) =>
            {
                ctx.status = 200
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify(test_model)
            })

        let inferPipeline: string | null = null
        const startPipelineRoute = server
            .post(`/worker/pipelines`)
            .mockImplementationOnce((ctx) =>
            {
                // @ts-ignore
                inferPipeline = ctx.request.body[ 'inferPipelineDef' ][ 'pipeline' ]
                ctx.status = 200
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id
                })
            })

        const getPipelineRoute = server
            .get(`/worker/pipelines/${test_pipeline_id}`)
            .mockImplementation((ctx) =>
            {
                ctx.status = 200
                ctx.response.headers[ 'content-type' ] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id,
                    inferPipeline: inferPipeline
                })
            })


        const changePopCompRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/inferencePipeline`)
            .mockImplementationOnce((ctx) =>
            {
                // @ts-ignore
                inferPipeline = ctx.request.body[ 'pipeline' ]
                ctx.status = 204
            })

        const endpoint = EyePop.endpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: { secretKey: test_secret_key },
            isSandbox: true,
            logger: pino({ level: 'debug' })
        })

        expect(endpoint).toBeDefined()

        try
        {
            await endpoint.connect()

            await endpoint.changeManifest(test_manifest);

            await endpoint.loadModel(test_model);

            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            expect(postSandboxes).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
            expect(sourcesRoute).toHaveBeenCalledTimes(1)
            expect(instancesRoute).toHaveBeenCalledTimes(1)

        } finally
        {
            await endpoint.disconnect()
        }
    })


})

