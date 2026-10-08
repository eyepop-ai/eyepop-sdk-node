import { EyePop, ForwardOperatorType, Pop, PopComponentType, PopForward, popSelects, PredictionVersion, SelectMode, validatePop } from '../../../src/eyepop'

import { MockServer } from 'jest-mock-server'
import { describe, expect, test } from '@jest/globals'
import { v4 as uuidv4 } from 'uuid'

function faceIdPop(forward: PopForward): Pop {
    return {
        components: [
            {
                type: PopComponentType.INFERENCE,
                ability: 'eyepop.person:latest',
                forward: {
                    operator: { type: ForwardOperatorType.CROP },
                    targets: [{ type: PopComponentType.TRACKING, reidModel: 'eyepop.person.reid:latest', forward }],
                },
            },
        ],
    }
}

const faceTargets = [{ type: PopComponentType.INFERENCE, ability: 'eyepop.person.face.short-range:latest' }]

const selectCrop: PopForward = {
    operator: {
        type: ForwardOperatorType.SELECT_CROP,
        select: { mode: SelectMode.MOST_RELEVANT, minTrackLengthSeconds: 1, intervalSeconds: 10 },
        crop: { boxPadding: 1.1 },
    },
    targets: faceTargets,
}

describe('select forwards', () => {
    test('a valid select_crop and select_full pass', () => {
        expect(() => validatePop(faceIdPop(selectCrop))).not.toThrow()
        expect(() => validatePop(faceIdPop({ operator: { type: ForwardOperatorType.SELECT_FULL, select: {} }, targets: faceTargets }))).not.toThrow()
    })

    test.each([
        ['a select operator without a select block', { type: ForwardOperatorType.SELECT_CROP }, 'requires a select block'],
        ['a select block on a crop', { type: ForwardOperatorType.CROP, select: {} }, 'only valid with the select_crop or select_full'],
        ['crop options on select_full', { type: ForwardOperatorType.SELECT_FULL, select: {}, crop: { boxPadding: 1.1 } }, 'only valid with select_crop'],
        ['maxItems on select_crop', { type: ForwardOperatorType.SELECT_CROP, select: {}, crop: { maxItems: 2 } }, 'maxItems does not apply'],
        ['an unknown mode', { type: ForwardOperatorType.SELECT_CROP, select: { mode: 'most-relevant' } }, 'not supported'],
        ['both relevancy model forms', { type: ForwardOperatorType.SELECT_CROP, select: { relevancyModel: 'a', relevancyModelUuid: 'b' } }, 'only have one of'],
        ['a negative minimum track length', { type: ForwardOperatorType.SELECT_CROP, select: { minTrackLengthSeconds: -1 } }, 'cannot be negative'],
        ['a zero interval', { type: ForwardOperatorType.SELECT_CROP, select: { intervalSeconds: 0 } }, 'must be positive'],
    ])('rejects %s', (_name, operator, message) => {
        // @ts-ignore the invalid cases do not type check, which is the point
        expect(() => validatePop(faceIdPop({ operator, targets: faceTargets }))).toThrow(message)
    })

    test('a Pop selects when any nested forward selects', () => {
        expect(popSelects(faceIdPop(selectCrop))).toBe(true)
        expect(popSelects(faceIdPop({ operator: { type: ForwardOperatorType.CROP }, targets: faceTargets }))).toBe(false)
        expect(popSelects({ components: [] })).toBe(false)
        expect(popSelects(null)).toBe(false)
    })
})

describe('EyePopSdk endpoint asks for selected predictions', () => {
    const server = new MockServer()

    beforeAll(() => server.start())
    afterAll(() => server.stop())
    beforeEach(() => server.reset())

    async function loadWith(pop: Pop): Promise<unknown> {
        const test_pop_id = uuidv4()
        const test_pipeline_id = uuidv4()
        server.post('/v1/auth/authenticate').mockImplementation(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ access_token: uuidv4(), expires_in: 1000 * 1000, token_type: 'Bearer' })
        })
        server.get(`/pops/${test_pop_id}/config`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ base_url: `${server.getURL()}worker/`, pipeline_id: test_pipeline_id })
        })
        server.get(`/worker/pipelines/${test_pipeline_id}`).mockImplementationOnce(ctx => {
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ id: test_pipeline_id, pop })
        })
        let version: unknown
        server.patch(`/worker/pipelines/${test_pipeline_id}/source`).mockImplementation(async ctx => {
            // @ts-ignore
            version = ctx.request.body['version']
            ctx.status = 200
            ctx.response.headers['content-type'] = 'application/json'
            ctx.body = JSON.stringify({ timestamp: 1 })
        })

        const endpoint = EyePop.workerEndpoint({
            eyepopUrl: server.getURL().toString(),
            auth: { apiKey: uuidv4() },
            popId: test_pop_id,
            stopJobs: false,
        })
        try {
            await endpoint.connect()
            const job = await endpoint.process({ source: { url: 'http://invalid.example' } })
            for await (const _ of job) {
            }
        } finally {
            await endpoint.disconnect()
        }
        return version
    }

    test('a Pop that selects asks for version 3', async () => {
        expect(await loadWith(faceIdPop(selectCrop))).toBe(PredictionVersion.V3)
    })

    test('any other Pop keeps asking for version 2', async () => {
        expect(await loadWith(faceIdPop({ operator: { type: ForwardOperatorType.CROP }, targets: faceTargets }))).toBe(PredictionVersion.V2)
    })
})
