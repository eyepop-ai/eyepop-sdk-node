import { EyePop, DataEndpoint } from '../../../src/eyepop'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

const ACCOUNT_ENV = ['EYEPOP_ACCOUNT_UUID', 'EYEPOP_ACCOUNT_ID']

const accountIdOf = (endpoint: DataEndpoint): string | null => (endpoint as unknown as { _accountId: string | null })._accountId

const dataEndpoint = (accountId?: string): DataEndpoint => EyePop.dataEndpoint({ eyepopUrl: 'http://example.test', apiKey: 'test api key', accountId, disableWs: true })

describe('EyePop.dataEndpoint account from the environment', () => {
    const saved: Record<string, string | undefined> = {}
    let warn: ReturnType<typeof jest.spyOn>

    beforeEach(() => {
        for (const name of ACCOUNT_ENV) {
            saved[name] = process.env[name]
            delete process.env[name]
        }
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        for (const name of ACCOUNT_ENV) {
            if (saved[name] === undefined) {
                delete process.env[name]
            } else {
                process.env[name] = saved[name]
            }
        }
        warn.mockRestore()
    })

    test('reads EYEPOP_ACCOUNT_UUID', () => {
        process.env['EYEPOP_ACCOUNT_UUID'] = 'uuid-1'
        expect(accountIdOf(dataEndpoint())).toBe('uuid-1')
        expect(warn).not.toHaveBeenCalled()
    })

    test('EYEPOP_ACCOUNT_UUID wins over EYEPOP_ACCOUNT_ID', () => {
        process.env['EYEPOP_ACCOUNT_UUID'] = 'uuid-1'
        process.env['EYEPOP_ACCOUNT_ID'] = 'id-1'
        expect(accountIdOf(dataEndpoint())).toBe('uuid-1')
        expect(warn).not.toHaveBeenCalled()
    })

    test('the accountId option wins over the environment', () => {
        process.env['EYEPOP_ACCOUNT_UUID'] = 'uuid-1'
        expect(accountIdOf(dataEndpoint('arg-1'))).toBe('arg-1')
    })

    test('unset gives no account', () => {
        expect(accountIdOf(dataEndpoint())).toBeNull()
    })

    // Runs last: the deprecation warning is printed once per process.
    test('falls back to the deprecated EYEPOP_ACCOUNT_ID and warns once', () => {
        process.env['EYEPOP_ACCOUNT_ID'] = 'id-1'
        expect(accountIdOf(dataEndpoint())).toBe('id-1')
        expect(accountIdOf(dataEndpoint())).toBe('id-1')
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('EYEPOP_ACCOUNT_ID is deprecated, use EYEPOP_ACCOUNT_UUID instead')
    })
})
