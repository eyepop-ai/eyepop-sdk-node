import { EyePop, VlmAbilityModelErrorReason } from '../../../src/eyepop'

import { afterEach, expect, jest, test } from '@jest/globals'

// Its own file: the deprecation warning is once per process, and Jest loads the SDK afresh per test file.

afterEach(() => {
    jest.restoreAllMocks()
})

test('worker_release warns once per process, model never', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const endpoint = EyePop.dataEndpoint({ eyepopUrl: 'http://example.test', apiKey: 'test api key', accountId: 'acc-1', disableWs: true })
    ;(endpoint as unknown as { request: () => Promise<unknown> }).request = async () => ({ uuid: 'ability-1' })
    const base = { name: 'people', description: 'finds people', text_prompt: 'p', config: {}, is_public: false }

    await endpoint.createVlmAbility({ ...base, model: 'qwen3' })
    await endpoint.updateVlmAbility('ability-1', { model: 'gemini_4_argon' })
    expect(warn).not.toHaveBeenCalled()

    await endpoint.createVlmAbility({ ...base, worker_release: 'qwen3_instruct' })
    await endpoint.updateVlmAbility('ability-1', { worker_release: 'gpt-6-astra' })
    await expect(endpoint.createVlmAbility({ ...base, worker_release: 'smol' })).rejects.toMatchObject({
        reason: VlmAbilityModelErrorReason.unknown_worker_release,
        fields: ['worker_release'],
    })
    expect(warn).toHaveBeenCalledTimes(1)
})
