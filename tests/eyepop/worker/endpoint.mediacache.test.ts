import { EyePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'
import { pino } from 'pino'

function prepMockServer(server: MockServer, popId: string, pipelineId: string) {
    server.post('/v1/auth/authenticate').mockImplementation(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ access_token: uuidv4(), expires_in: 1000 * 1000, token_type: 'Bearer' })
    })
    server.get(`/pops/${popId}/config`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/`, pipeline_id: pipelineId })
    })
    server.get(`/worker/pipelines/${pipelineId}`).mockImplementationOnce(ctx => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({ id: pipelineId })
    })
}

describe('a worker session records a source to the media cache (spec 024)', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    test('mediaCacheSeconds and mediaCacheReencode go in the body of a url source, and are left out when unset', async () => {
        const popId = uuidv4()
        const pipelineId = uuidv4()
        prepMockServer(server, popId, pipelineId)
        const bodies: Array<Record<string, any>> = []
        server.patch(`/worker/pipelines/${pipelineId}/source`).mockImplementation(async ctx => {
            // @ts-ignore
            bodies.push(ctx.request.body as Record<string, any>)
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: 0 })
        })
        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: uuidv4() }, popId, stopJobs: false, isPipelineMode: false })
        try {
            await endpoint.connect()
            for await (const _ of await endpoint.process({ source: { url: 'rtsp://camera.example/1' }, mediaCacheSeconds: 3600, mediaCacheReencode: true })) {
            }
            for await (const _ of await endpoint.process({ source: { url: 'rtsp://camera.example/2' } })) {
            }
        } finally {
            await endpoint.disconnect()
        }
        expect(bodies).toHaveLength(2)
        expect(bodies[0]?.['mediaCacheSeconds']).toBe(3600)
        expect(bodies[0]?.['mediaCacheReencode']).toBe(true)
        expect(bodies[1]).not.toHaveProperty('mediaCacheSeconds')
        expect(bodies[1]).not.toHaveProperty('mediaCacheReencode')
    })

    test('an upload sends mediaCacheSeconds in its query but not mediaCacheReencode, and the endpoint warns once', async () => {
        const popId = uuidv4()
        const pipelineId = uuidv4()
        prepMockServer(server, popId, pipelineId)
        const queries: Array<Record<string, any>> = []
        server.post(`/worker/pipelines/${pipelineId}/source`).mockImplementation(async ctx => {
            queries.push({ ...ctx.request.query })
            await ctx.request.req.toArray()
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: 0 })
        })
        const warnings: string[] = []
        const logger = pino({ level: 'warn' }, { write: (line: string) => warnings.push(JSON.parse(line).msg) })
        const endpoint = EyePop.workerEndpoint({ eyepopUrl: server.getURL().toString(), auth: { apiKey: uuidv4() }, popId, stopJobs: false, isPipelineMode: false, logger })
        try {
            await endpoint.connect()
            for (let i = 0; i < 2; i++) {
                for await (const _ of await endpoint.process({ source: { path: './tests/test.jpg' }, mediaCacheSeconds: 60, mediaCacheReencode: true })) {
                }
            }
        } finally {
            await endpoint.disconnect()
        }
        expect(queries).toHaveLength(2)
        expect(queries[0]?.['mediaCacheSeconds']).toBe('60')
        expect(queries[0]).not.toHaveProperty('mediaCacheReencode')
        expect(warnings.filter(line => line.includes('mediaCacheReencode has no effect'))).toHaveLength(1)
    })
})
