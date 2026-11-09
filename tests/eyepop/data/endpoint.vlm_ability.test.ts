import {
    AutoAnnotateTask,
    DataEndpoint,
    EyePop,
    VLM_MODEL_WORKER_RELEASES,
    VlmAbilityCreate,
    VlmAbilityModeError,
    VlmAbilityModeErrorReason as Reason,
    VlmAbilityModelError,
    VlmAbilityModelErrorReason as ModelReason,
    VlmAbilityUpdate,
    VlmModel,
} from '../../../src/eyepop'

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
    model: 'qwen3' as VlmModel,
    config: {},
    is_public: false,
}

/** What a create with `base` sends: `model` plus, until the next major, its worker release. */
const sent = { ...base, worker_release: 'qwen3_instruct' }

const prompts = [{ label: 'person', prompt: 'a person, standing or sitting' }]

async function expectModelError(call: Promise<unknown>, reason: ModelReason, fields: string[]): Promise<void> {
    const error = await call.then(
        () => undefined,
        (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(VlmAbilityModelError)
    expect((error as VlmAbilityModelError).reason).toBe(reason)
    expect((error as VlmAbilityModelError).fields).toEqual(fields)
}

async function expectModeError(call: Promise<unknown>, reason: Reason, fields: string[]): Promise<void> {
    const error = await call.then(
        () => undefined,
        (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(VlmAbilityModeError)
    expect((error as VlmAbilityModeError).reason).toBe(reason)
    expect((error as VlmAbilityModeError).fields).toEqual(fields)
}

describe('DataEndpoint.createVlmAbility', () => {
    test('a free-form ability sends text_prompt, transform_into and response_schema', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, text_prompt: 'Is there a person?', transform_into: { classes: ['yes', 'no'] } })
        expect(request.mock.calls[0][0]).toBe('/vlm_abilities?account_uuid=acc-1')
        expect(bodyOf(request)).toEqual({ ...sent, text_prompt: 'Is there a person?', transform_into: { classes: ['yes', 'no'] } })
    })

    test('a free-form ability needs no transform_into', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, text_prompt: 'Describe the scene.' })
        expect(bodyOf(request)).toEqual({ ...sent, text_prompt: 'Describe the scene.' })
    })

    test.each([AutoAnnotateTask.object_detection, AutoAnnotateTask.image_classification])('a %s task ability sends task and prompts only', async task => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, task, prompts }, 'group-1')
        expect(request.mock.calls[0][0]).toBe('/vlm_abilities?account_uuid=acc-1&vlm_ability_group_uuid=group-1')
        const body = bodyOf(request)
        expect(body).toEqual({ ...sent, task, prompts })
        expect(body).not.toHaveProperty('text_prompt')
        expect(body).not.toHaveProperty('transform_into')
    })

    test('null free-form fields count as unset next to a task', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...base, task: AutoAnnotateTask.object_detection, prompts, text_prompt: null, transform_into: null } as unknown as VlmAbilityCreate)
        expect(bodyOf(request)).toEqual({ ...sent, task: 'object_detection', prompts })
    })

    test.each<[string, Partial<VlmAbilityCreate>, Reason, string[]]>([
        ['neither mode', {}, Reason.missing_mode, ['text_prompt', 'task']],
        ['an empty text_prompt', { text_prompt: '' }, Reason.missing_mode, ['text_prompt', 'task']],
        ['transform_into without text_prompt', { transform_into: { classes: ['a'] } }, Reason.missing_mode, ['text_prompt', 'task']],
        ['a task without prompts', { task: AutoAnnotateTask.object_detection }, Reason.task_without_prompts, ['prompts']],
        ['a task with empty prompts', { task: AutoAnnotateTask.object_detection, prompts: [] }, Reason.empty_prompts, ['prompts']],
        ['prompts without a task', { prompts }, Reason.prompts_without_task, ['prompts']],
        ['a task with text_prompt', { task: AutoAnnotateTask.object_detection, prompts, text_prompt: 'x' }, Reason.task_excludes_free_form, ['text_prompt']],
        [
            'a task with transform_into and response_schema',
            { task: AutoAnnotateTask.image_classification, prompts, transform_into: { classes: ['a'] }, response_schema: { type: 'object' } },
            Reason.task_excludes_free_form,
            ['transform_into', 'response_schema'],
        ],
        ['an unknown task', { task: 'segmentation' as AutoAnnotateTask, prompts }, Reason.unknown_task, ['task']],
        ['a prompt without a label', { task: AutoAnnotateTask.object_detection, prompts: [{ label: '', prompt: 'p' }] }, Reason.invalid_prompt, ['prompts[0]']],
    ])('refuses %s without a request', async (_, fields, reason, faulty) => {
        const { endpoint, request } = stubbedEndpoint()
        await expectModeError(endpoint.createVlmAbility({ ...base, ...fields } as VlmAbilityCreate), reason, faulty)
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

    test.each<[string, Parameters<DataEndpoint['updateVlmAbility']>[1], Reason, string[]]>([
        ['a task with text_prompt', { task: AutoAnnotateTask.object_detection, text_prompt: 'x' }, Reason.task_excludes_free_form, ['text_prompt']],
        ['prompts with response_schema', { prompts, response_schema: { type: 'object' } }, Reason.task_excludes_free_form, ['response_schema']],
        ['empty prompts', { prompts: [] }, Reason.empty_prompts, ['prompts']],
    ])('refuses %s', async (_, update, reason, faulty) => {
        const { endpoint, request } = stubbedEndpoint()
        await expectModeError(endpoint.updateVlmAbility('ability-1', update), reason, faulty)
        expect(request).not.toHaveBeenCalled()
    })
})

describe('VLM ability model', () => {
    const { model: _, ...withoutModel } = base

    test('maps each model to its worker release', () => {
        expect(VLM_MODEL_WORKER_RELEASES).toEqual({ qwen3: 'qwen3_instruct', gpt_6_astra: 'gpt-6-astra', gemini_4_argon: 'gemini-4-argon' })
    })

    test.each<[VlmModel, string]>([
        ['qwen3', 'qwen3_instruct'],
        ['gpt_6_astra', 'gpt-6-astra'],
        ['gemini_4_argon', 'gemini-4-argon'],
    ])('a create with model %s also sends worker_release %s', async (model, release) => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...withoutModel, model, text_prompt: 'p' })
        expect(bodyOf(request)).toEqual({ ...withoutModel, model, worker_release: release, text_prompt: 'p' })
    })

    test('a create with neither model nor worker_release sends neither', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...withoutModel, text_prompt: 'p' })
        const body = bodyOf(request)
        expect(body).not.toHaveProperty('model')
        expect(body).not.toHaveProperty('worker_release')
    })

    test.each(['qwen3_instruct', 'qwen3-instruct', 'QWEN3-Instruct', 'gemini_4_argon', 'gpt-6-astra'])('a create with worker_release %s alone sends it unchanged', async release => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...withoutModel, worker_release: release, text_prompt: 'p' })
        expect(bodyOf(request)).toEqual({ ...withoutModel, worker_release: release, text_prompt: 'p' })
    })

    test('a create with a model and a worker_release that agree sends both as given', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.createVlmAbility({ ...withoutModel, model: 'gemini_4_argon', worker_release: 'Gemini_4_Argon', text_prompt: 'p' })
        expect(bodyOf(request)).toEqual({ ...withoutModel, model: 'gemini_4_argon', worker_release: 'Gemini_4_Argon', text_prompt: 'p' })
    })

    test.each<[string, Partial<VlmAbilityCreate>, ModelReason, string[]]>([
        ['an unknown worker_release', { worker_release: 'smol22b-instruct' }, ModelReason.unknown_worker_release, ['worker_release']],
        ['an empty worker_release', { worker_release: '' }, ModelReason.unknown_worker_release, ['worker_release']],
        ['an unknown model', { model: 'qwen2' as VlmModel }, ModelReason.unknown_model, ['model']],
        ['a model and a worker_release that disagree', { model: 'gpt_6_astra', worker_release: 'qwen3-instruct' }, ModelReason.model_conflict, ['model', 'worker_release']],
    ])('a create refuses %s without a request', async (_, fields, reason, faulty) => {
        const { endpoint, request } = stubbedEndpoint()
        await expectModelError(endpoint.createVlmAbility({ ...withoutModel, ...fields, text_prompt: 'p' } as VlmAbilityCreate), reason, faulty)
        expect(request).not.toHaveBeenCalled()
    })

    test('an update with model also sends its worker release', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.updateVlmAbility('ability-1', { model: 'gpt_6_astra' })
        expect(bodyOf(request)).toEqual({ model: 'gpt_6_astra', worker_release: 'gpt-6-astra' })
    })

    test('an update without model or worker_release leaves both out', async () => {
        const { endpoint, request } = stubbedEndpoint()
        await endpoint.updateVlmAbility('ability-1', { name: 'renamed' })
        expect(bodyOf(request)).toEqual({ name: 'renamed' })
    })

    test.each<[string, VlmAbilityUpdate, ModelReason, string[]]>([
        ['an unknown worker_release', { worker_release: 'test-worker-release' }, ModelReason.unknown_worker_release, ['worker_release']],
        ['a model and a worker_release that disagree', { model: 'qwen3', worker_release: 'gemini-4-argon' }, ModelReason.model_conflict, ['model', 'worker_release']],
    ])('an update refuses %s without a request', async (_, update, reason, faulty) => {
        const { endpoint, request } = stubbedEndpoint()
        await expectModelError(endpoint.updateVlmAbility('ability-1', update), reason, faulty)
        expect(request).not.toHaveBeenCalled()
    })
})
