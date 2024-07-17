import {EyePop, Session} from '../../src/eyepop'

import {MockServer} from 'jest-mock-server'
import {describe, expect, test} from '@jest/globals'
import {v4 as uuidv4} from 'uuid'
import {TransientPopId} from "../../src/eyepop/options";

describe('EyePopSdk endpoint module auth and connect for transient popId', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    const test_pop_id = TransientPopId.Transient
    const test_pipeline_id = uuidv4()
    const test_secret_key = uuidv4()
    const test_access_token = uuidv4()
    const short_token_valid_time = 1
    const long_token_valid_time = 1000 * 1000

    test('EyePopSdk connect transient', async () => {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const popConfigRoute = server
            .get(`/workers/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`})
            })

        const stopRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 204
            })

        const startPipelineRoute = server
            .post(`/worker/pipelines`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id
                })
            })

        const getPipelineRoute = server
            .get(`/worker/pipelines/${test_pipeline_id}`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id
                })
            })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: {secretKey: test_secret_key}
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

    test('EyePopSdk changePopComp transient', async () => {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const popConfigRoute = server
            .get(`/workers/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`})
            })

        const stopRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 204
            })

        let inferPipeline:string|null = null
        const startPipelineRoute = server
            .post(`/worker/pipelines`)
            .mockImplementationOnce((ctx) => {
                // @ts-ignore
                inferPipeline = ctx.request.body['inferPipelineDef']['pipeline']
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id
                })
            })

        const getPipelineRoute = server
            .get(`/worker/pipelines/${test_pipeline_id}`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id,
                    inferPipeline: inferPipeline
                })
            })


        const changePopCompRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/inferencePipeline`)
            .mockImplementationOnce((ctx) => {
                // @ts-ignore
                inferPipeline = ctx.request.body['pipeline']
                ctx.status = 204
            })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: {secretKey: test_secret_key}
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
            expect(getPipelineRoute).toHaveBeenCalledTimes(1)

            let popComp = await endpoint.popComp()
            expect(popComp).toBe('identity')

            await endpoint.changePopComp('identity ! identity')
            popComp = await endpoint.popComp()
            expect(popComp).toBe('identity ! identity')
            expect(inferPipeline).toBe('identity ! identity')
            expect(changePopCompRoute).toHaveBeenCalledTimes(1)

        } finally {
            await endpoint.disconnect()
        }
    })

    test('EyePopSdk changePostTransform transient', async () => {
        const authenticationRoute = server
            .post('/authentication/token')
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    access_token: test_access_token,
                    expires_in: long_token_valid_time,
                    token_type: 'Bearer'
                })
            })

        const popConfigRoute = server
            .get(`/workers/config`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`})
            })

        const stopRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/source`)
            .mockImplementationOnce((ctx) => {
                ctx.status = 204
            })

        let inferPipeline:string|null = null
        let postTransform:string|null = null

        const startPipelineRoute = server
            .post(`/worker/pipelines`)
            .mockImplementationOnce((ctx) => {
                // @ts-ignore
                inferPipeline = ctx.request.body['inferPipelineDef']['pipeline']
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id
                })
            })

        const getPipelineRoute = server
            .get(`/worker/pipelines/${test_pipeline_id}`)
            .mockImplementation((ctx) => {
                ctx.status = 200
                ctx.response.headers['content-type'] = 'application/json'
                ctx.body = JSON.stringify({
                    id: test_pipeline_id,
                    inferPipeline: inferPipeline,
                    postTransform: postTransform
                })
            })


        const changePostTransformRoute = server
            .patch(`/worker/pipelines/${test_pipeline_id}/postTransform`)
            .mockImplementation((ctx) => {
                // @ts-ignore
                postTransform = ctx.request.body['transform']
                ctx.status = 204
            })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id,
            auth: {secretKey: test_secret_key}
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.connect()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            expect(startPipelineRoute).toHaveBeenCalledTimes(1)
            expect(stopRoute).toHaveBeenCalledTimes(1)
            expect(getPipelineRoute).toHaveBeenCalledTimes(1)

            let transform = await endpoint.postTransform()
            expect(transform).toBeNull()

            await endpoint.changePostTransform('"foo"')
            transform = await endpoint.postTransform()
            expect(transform).toBe('"foo"')
            expect(postTransform).toBe('"foo"')
            expect(changePostTransformRoute).toHaveBeenCalledTimes(1)

            await endpoint.changePostTransform("")
            transform = await endpoint.postTransform()
            expect(transform).toBeNull()
            expect(postTransform).toBeNull()
            expect(changePostTransformRoute).toHaveBeenCalledTimes(2)

            await endpoint.changePostTransform('"foo"')
            transform = await endpoint.postTransform()
            expect(transform).toBe('"foo"')
            expect(postTransform).toBe('"foo"')
            expect(changePostTransformRoute).toHaveBeenCalledTimes(3)

            await endpoint.changePostTransform(null)
            transform = await endpoint.postTransform()
            expect(transform).toBeNull()
            expect(postTransform).toBeNull()
            expect(changePostTransformRoute).toHaveBeenCalledTimes(4)
        } finally {
            await endpoint.disconnect()
        }
    })
})

