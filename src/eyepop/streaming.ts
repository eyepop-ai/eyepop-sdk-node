type Bytes = string | ArrayBuffer | Uint8Array | Buffer | null | undefined

export interface StreamEvent {
    type: string
    source_id?: string
    message?: string
}

export class Stream<Prediction> implements AsyncIterable<Prediction> {
    controller: AbortController

    constructor(
        private iterator: () => AsyncIterator<Prediction>,
        controller: AbortController,
    ) {
        this.controller = controller
    }

    static iterFromReadableStream<Prediction>(
        readableStream: Promise<ReadableStream<Uint8Array>>,
        controller: AbortController,
        eventHandler: (event: StreamEvent) => Promise<void>,
    ): AsyncIterator<Prediction, any, undefined> {
        let consumed = false

        async function* iterLines(): AsyncGenerator<string, void, unknown> {
            const lineDecoder = new EyepopLineDecoder()
            const iter = readableStreamAsyncIterable<Bytes>(await readableStream)
            for await (let chunk of iter) {
                for (const line of lineDecoder.decode(chunk)) {
                    yield line
                }
            }

            for (const line of lineDecoder.flush()) {
                yield line
            }
        }

        async function* iterator(): AsyncIterator<Prediction, any, undefined> {
            if (consumed) {
                throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.')
            }
            consumed = true
            let done = false
            try {
                for await (const line of iterLines()) {
                    if (done) continue
                    if (line) {
                        const message = JSON.parse(line)
                        const event = message['event']
                        if (event !== undefined) {
                            await eventHandler(event)
                        } else {
                            yield message
                        }
                    }
                }
                done = true
            } catch (e) {
                // If the user calls `stream.controller.abort()`, we should exit without throwing.
                if (e instanceof Error && e.name === 'AbortError') return
                throw e
            } finally {
                // If the user `break`s, abort the ongoing request.
                if (!done) controller.abort()
            }
        }

        return iterator()
    }

    [Symbol.asyncIterator](): AsyncIterator<Prediction> {
        return this.iterator()
    }

    /**
     * Splits the stream into two streams which can be
     * independently read from at different speeds.
     */
    tee(): [Stream<Prediction>, Stream<Prediction>] {
        const left: Array<Promise<IteratorResult<Prediction>>> = []
        const right: Array<Promise<IteratorResult<Prediction>>> = []
        const iterator = this.iterator()

        const teeIterator = (queue: Array<Promise<IteratorResult<Prediction>>>): AsyncIterator<Prediction> => {
            return {
                next: () => {
                    if (queue.length === 0) {
                        const result = iterator.next()
                        left.push(result)
                        right.push(result)
                    }
                    return queue.shift()!
                },
            }
        }

        return [new Stream(() => teeIterator(left), this.controller), new Stream(() => teeIterator(right), this.controller)]
    }
}

/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
export class EyepopLineDecoder {
    // prettier-ignore
    static NEWLINE_CHARS = new Set(['\n', '\r', '\x0b', '\x0c', '\x1c', '\x1d', '\x1e', '\x85', '\u2028', '\u2029']);
    static NEWLINE_REGEXP = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g

    buffer: string[]
    trailingCR: boolean
    textDecoder: any // TextDecoder found in browsers; not typed to avoid pulling in either "dom" or "node" types.

    constructor() {
        this.buffer = []
        this.trailingCR = false
    }

    decode(chunk: Bytes): string[] {
        let text = this.decodeText(chunk)

        if (this.trailingCR) {
            text = '\r' + text
            this.trailingCR = false
        }
        if (text.endsWith('\r')) {
            this.trailingCR = true
            text = text.slice(0, -1)
        }

        if (!text) {
            return []
        }

        const trailingNewline = EyepopLineDecoder.NEWLINE_CHARS.has(text[text.length - 1] || '')
        let lines = text.split(EyepopLineDecoder.NEWLINE_REGEXP)

        if (lines.length === 1 && !trailingNewline) {
            this.buffer.push(lines[0]!)
            return []
        }

        if (this.buffer.length > 0) {
            lines = [this.buffer.join('') + lines[0], ...lines.slice(1)]
            this.buffer = []
        }

        if (!trailingNewline) {
            this.buffer = [lines.pop() || '']
        }

        return lines
    }

    decodeText(bytes: Bytes): string {
        if (bytes == null) return ''
        if (typeof bytes === 'string') return bytes

        // Node:
        if (typeof Buffer !== 'undefined') {
            if (bytes instanceof Buffer) {
                return bytes.toString()
            }
            if (bytes instanceof Uint8Array) {
                return Buffer.from(bytes).toString()
            }

            throw new Error(
                `Unexpected: received non-Uint8Array (${bytes.constructor.name}) stream chunk in an environment with a global "Buffer" defined, which this library assumes to be Node. Please report this error.`,
            )
        }

        // Browser
        if (typeof TextDecoder !== 'undefined') {
            if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
                this.textDecoder ??= new TextDecoder('utf8')
                return this.textDecoder.decode(bytes)
            }

            throw new Error(`Unexpected: received non-Uint8Array/ArrayBuffer (${(bytes as any).constructor.name}) in a web platform. Please report this error.`)
        }

        throw new Error(`Unexpected: neither Buffer nor TextDecoder are available as globals. Please report this error.`)
    }

    flush(): string[] {
        if (!this.buffer.length && !this.trailingCR) {
            return []
        }

        const lines = [this.buffer.join('')]
        this.buffer = []
        this.trailingCR = false
        return lines
    }
}

/**
 * Most browsers don't yet have async iterable support for ReadableStream,
 * and Node has a very different way of reading bytes from its "ReadableStream".
 *
 * This polyfill was pulled from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490
 */
function readableStreamAsyncIterable<T>(stream: any): AsyncIterableIterator<T> {
    if (stream[Symbol.asyncIterator]) {
        return stream[Symbol.asyncIterator]()
    }

    const reader = stream.getReader()

    return {
        async next() {
            try {
                const result = await reader.read()
                if (result?.done) reader.releaseLock() // release lock when stream becomes closed
                return result
            } catch (e) {
                reader.releaseLock() // release lock when stream becomes errored
                throw e
            }
        },
        async return() {
            const cancelPromise = reader.cancel()
            reader.releaseLock()
            await cancelPromise
            return { done: true, value: undefined }
        },
        [Symbol.asyncIterator]() {
            return this
        },
    }
}
export function readableStreamFromString(s: string) : ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(Buffer.from(s));
            controller.close();
        }
    });
}