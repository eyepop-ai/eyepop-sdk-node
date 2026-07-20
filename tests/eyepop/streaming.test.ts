import { encodeMultipartFormData } from '../../src/eyepop/streaming'

import { describe, expect, test } from '@jest/globals'

describe('encodeMultipartFormData', () => {
    test('cancels active and unstarted stream parts', async () => {
        let activeCancelReason: unknown
        let unstartedCancelReason: unknown

        const active = new ReadableStream<Uint8Array>({
            cancel(reason) {
                activeCancelReason = reason
            },
        })
        const unstarted = new ReadableStream<Uint8Array>({
            cancel(reason) {
                unstartedCancelReason = reason
            },
        })

        const body = encodeMultipartFormData(
            [
                { name: 'file', contentType: 'application/octet-stream', content: active },
                { name: 'file', contentType: 'application/octet-stream', content: unstarted },
            ],
            'test-boundary',
        )
        const reader = body.getReader()

        await reader.read()
        await reader.cancel('cancelled')

        expect(activeCancelReason).toBe('cancelled')
        expect(unstartedCancelReason).toBe('cancelled')
    })
})
