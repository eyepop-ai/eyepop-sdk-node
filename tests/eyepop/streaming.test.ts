import { encodeMultipartFormData, readableStreamFromString, Stream, StreamEvent } from '../../src/eyepop/streaming'

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

    test('escapes quotes and line breaks in the name and filename', async () => {
        const body = encodeMultipartFormData([{ name: 'a"b', filename: 'x"y\r\nz.jpg', content: new Uint8Array([1]) }], 'test-boundary')
        const text = await new Response(body).text()

        expect(text).toContain('Content-Disposition: form-data; name="a%22b"; filename="x%22y%0D%0Az.jpg"\r\n')
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

// An event line is the pipeline's, {"event": "<type>", ...}, which an instance session forwards as is, or the
// instance's own, {"event": {"type": "<type>", ...}}. New types come without a version bump ("warning" since
// worker v4.19.11), so the stream hands every event to its handler with the same shape and yields only predictions.
describe('Stream events', () => {
    async function read(lines: object[]): Promise<{ predictions: unknown[]; events: StreamEvent[] }> {
        const events: StreamEvent[] = []
        const body = lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
        const iterator = Stream.iterFromReadableStream<unknown>(Promise.resolve(readableStreamFromString(body)), new AbortController(), async (event) => {
            events.push(event)
        })
        const predictions: unknown[] = []
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            predictions.push(next.value)
        }
        return { predictions, events }
    }

    test('an event of the pipeline form reaches the handler with its type, source and message', async () => {
        const warning = {
            event: 'warning',
            source_id: 's',
            message: 'no keyframe for 12 s',
            info: { code: 'media_cache_gop_too_long', level: 'warn', gap_ms: 12000, threshold_ms: 10000 },
        }
        const { predictions, events } = await read([{ seconds: 0 }, warning, { seconds: 1 }])

        expect(predictions).toEqual([{ seconds: 0 }, { seconds: 1 }])
        expect(events).toEqual([{ type: 'warning', source_id: 's', message: 'no keyframe for 12 s', info: warning.info }])
    })

    test('an event of the instance form reaches the handler unchanged', async () => {
        const { predictions, events } = await read([{ event: { type: 'prepared', source_id: 's' } }, { seconds: 0 }])

        expect(predictions).toEqual([{ seconds: 0 }])
        expect(events).toEqual([{ type: 'prepared', source_id: 's' }])
    })

    test('an error of the pipeline form fails the stream, as one of the instance form does', async () => {
        for (const error of [
            { event: 'error', source_id: 's', message: 'cannot open the camera' },
            { event: { type: 'error', source_id: 's', message: 'cannot open the camera' } },
        ]) {
            const body = [{ seconds: 0 }, error].map((line) => JSON.stringify(line)).join('\n') + '\n'
            const iterator = Stream.iterFromReadableStream<unknown>(Promise.resolve(readableStreamFromString(body)), new AbortController(), async (event) => {
                if (event.type == 'error') {
                    return Promise.reject(`Error event for source ${event.source_id}: ${event.message}`)
                }
            })
            expect((await iterator.next()).value).toEqual({ seconds: 0 })
            await expect(iterator.next()).rejects.toEqual('Error event for source s: cannot open the camera')
        }
    })
})
