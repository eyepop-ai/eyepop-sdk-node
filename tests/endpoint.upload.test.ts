import {MockServer} from 'jest-mock-server'
import {describe, expect, test} from '@jest/globals'
import {EyePopSdk} from '../src'
import {v4 as uuidv4} from 'uuid'
import {ReadStream} from "fs";
import { Readable } from 'node:stream';
import * as fs from "fs";

function prepMockServer(server: MockServer, test_pop_id: string, test_pipeline_id: string) {
    const test_access_token = uuidv4()
    const token_valid_time = 1000 * 1000

    const authenticationRoute = server
        .post('/authentication/token')
        .mockImplementation((ctx) => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({
                access_token: test_access_token,
                expires_in: token_valid_time,
                token_type: 'Bearer'
            })
        })

    const popConfigRoute = server
        .get(`/pops/${test_pop_id}/config`)
        .mockImplementationOnce((ctx) => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id})
        })
    return {authenticationRoute, popConfigRoute};
}

describe('EyePopSdk endpoint module upload', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('EyePopSdk upload', async () => {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        const image_path = './tests/test.jpg'
        const {authenticationRoute, popConfigRoute} = prepMockServer(server, test_pop_id, test_pipeline_id)

        const uploadRoute = server
        .post(`/worker/pipelines/${test_pipeline_id}/source`)
        .mockImplementation(async (ctx) => {
            expect(ctx.headers['authorization']).toBeDefined()
            expect(ctx.request.query['mode']).toBe('queue')
            expect(ctx.request.query['processing']).toBe('sync')
            console.log(await ctx.request.body)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({timestamp: 0})
        })

        const endpoint = EyePopSdk.endpoint({
            eyepopUrl: server.getURL().toString(),
            popId: test_pop_id
        })
        expect(endpoint).toBeDefined()
        try {
            await endpoint.open()
            expect(authenticationRoute).toHaveBeenCalledTimes(1)
            expect(popConfigRoute).toHaveBeenCalledTimes(1)
            const f: fs.ReadStream = fs.createReadStream(image_path)
            let result = await endpoint.upload(f)
            expect(uploadRoute).toHaveBeenCalledTimes(1)
            expect(result).toBeDefined()
            let count = 0
            for await (let prediction of result) {
                count++
            }
            expect(count).toBe(1)
        } finally {
            await endpoint.close()
        }
    })
})