import { AutoAnnotateTask, DataEndpoint, EyePop, VlmAbilityCreate } from '../../../src/eyepop'

import { describe, expect, jest, test } from '@jest/globals'

type RequestFn = (path: string, options?: RequestInit) => Promise<unknown>

function stubbedEndpoint(): { endpoint: DataEndpoint; request: jest.Mock<RequestFn> } {
    const endpoint = EyePop.dataEndpoint({ eyepopUrl: 'http://example.test', apiKey: 'test api key', accountId: 'acc-1', disableWs: true })
    const request = jest.fn<RequestFn>(async () => ({ uuid: 'ability-1' }))
    ;(endpoint as unknown as { request: RequestFn }).request = request
    return { endpoint, request }
}

function bodyOf(request: jest.Mock<RequestFn>): Record<string, unknown> {
    expect(request).toHaveBeenCalledTimes(1)
    return JSON.parse(request.mock.calls[0][1]!.body as string)
}

const base = {
    name: 'people',
    description: 'finds people',
    worker_release: 'qwen3-instruct',
    config: {},
    is_public: false,
}

const prompts = [{ label: 'person', prompt: 'a person, standing or sitting' }]

describe('DataEndpoint.createVlmAbility', () => {
    test('a free-form ability sends text_prompt, transform_into and response_schema', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, text_prompt: 'Is there a person?', transform_into: { classes: ['yes', 'no'] } })
        expect(request.mock.calls[0][0]).toBe('/vlm_abilities?account_uuid=acc-1')
        expect(bodyOf(request)).toEqual({ ...base, text_prompt: 'Is there a person?', transform_into: { classes: ['yes', 'no'] } })
    })

    test('a free-form ability needs no transform_into', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, text_prompt: 'Describe the scene.' })
        expect(bodyOf(request)).toEqual({ ...base, text_prompt: 'Describe the scene.' })
    })

    test.each([AutoAnnotateTask.object_detection, AutoAnnotateTask.image_classification])('a %s task ability sends task and prompts only', async task => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, task, prompts }, 'group-1')
        expect(request.mock.calls[0][0]).toBe('/vlm_abilities?account_uuid=acc-1&vlm_ability_group_uuid=group-1')
        const body = bodyOf(request)
        expect(body).toEqual({ ...base, task, prompts })
        expect(body).not.toHaveProperty('text_prompt')
        expect(body).not.toHaveProperty('transform_into')
    })

    test('null free-form fields count as unset next to a task', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, task: AutoAnnotateTask.object_detection, prompts, text_prompt: null, transform_into: null } as unknown as VlmAbilityCreate)
        expect(bodyOf(request)).toEqual({ ...base, task: 'object_detection', prompts })
    })

    test.each<[string, Partial<VlmAbilityCreate>, RegExp]>([
        ['neither mode', {}, /set either text_prompt \(free-form\) or task with non-empty prompts/],
        ['an empty text_prompt', { text_prompt: '' }, /set either text_prompt/],
        ['transform_into without text_prompt', { transform_into: { classes: ['a'] } }, /set either text_prompt/],
        ['a task without prompts', { task: AutoAnnotateTask.object_detection }, /requires a non-empty prompts list/],
        ['a task with empty prompts', { task: AutoAnnotateTask.object_detection, prompts: [] }, /prompts must be a non-empty list/],
        ['prompts without a task', { prompts }, /prompts are only used with a task/],
        ['a task with text_prompt', { task: AutoAnnotateTask.object_detection, prompts, text_prompt: 'x' }, /text_prompt must be unset/],
        [
            'a task with transform_into and response_schema',
            { task: AutoAnnotateTask.image_classification, prompts, transform_into: { classes: ['a'] }, response_schema: { type: 'object' } },
            /transform_into, response_schema must be unset/,
        ],
        ['an unknown task', { task: 'segmentation' as AutoAnnotateTask, prompts }, /unknown task 'segmentation'/],
        ['a prompt without a label', { task: AutoAnnotateTask.object_detection, prompts: [{ label: '', prompt: 'p' }] }, /prompts\[0\] needs a non-empty label and prompt/],
    ])('refuses %s without a request', async (_, fields, message) => {
        const { endpoint, request } = stubbedEndpoint()
        await expect(endpoint.createVlmAbility({ ...base, ...fields } as VlmAbilityCreate)).rejects.toThrow(message)
        expect(request).not.toHaveBeenCalled()
    })
})

describe('DataEndpoint.updateVlmAbility', () => {
    test('sends a partial update unchanged', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.updateVlmAbility('ability-1', { prompts })
        expect(request.mock.calls[0][0]).toBe('/vlm_abilities/ability-1')
        expect(request.mock.calls[0][1]!.method).toBe('PATCH')
        expect(bodyOf(request)).toEqual({ prompts })
    })

    test('sends a switch to a task', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.updateVlmAbility('ability-1', { task: AutoAnnotateTask.image_classification, prompts })
        expect(bodyOf(request)).toEqual({ task: 'image_classification', prompts })
    })

    test('sends a free-form update', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.updateVlmAbility('ability-1', { text_prompt: 'new prompt' })
        expect(bodyOf(request)).toEqual({ text_prompt: 'new prompt' })
    })

    test.each([
        ['a task with text_prompt', { task: AutoAnnotateTask.object_detection, text_prompt: 'x' }, /text_prompt must be unset/],
        ['prompts with response_schema', { prompts, response_schema: { type: 'object' as const } }, /response_schema must be unset/],
        ['empty prompts', { prompts: [] }, /prompts must be a non-empty list/],
    ])('refuses %s', async (_, update, message) => {
        const { endpoint, request } = stubbedEndpoint()
        await expect(endpoint.updateVlmAbility('ability-1', update)).rejects.toThrow(message)
        expect(request).not.toHaveBeenCalled()
    })
})
