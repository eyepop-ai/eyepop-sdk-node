import { encodeMultipartFormData } from '../../src/eyepop/streaming'

import { describe, expect, test } from '@jest/globals'

describe('encodeMultipartFormData', () => {
    test('writes a filename only on parts that have one', async () => {
        const body = encodeMultipartFormData(
            [
                { name: 'params', contentType: 'application/json', content: '[]' },
                { name: 'file', filename: 'blob', contentType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) },
            ],
            'test-boundary',
        )
        const text = await new Response(body).text()

        expect(text).toContain('Content-Disposition: form-data; name="params"\r\n')
        expect(text).toContain('Content-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: image/jpeg\r\n')
    })

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
