import {PathSource, StreamSource} from "EyePop";
import * as fs from "node:fs";

export let resolvePath: (source: PathSource) => Promise<StreamSource>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    resolvePath = async (source: PathSource) => {
        throw new DOMException("resolving a path to a file is not supported in browser")
    }
} else {
    /**
     * From https://github.com/MattMorgis/async-stream-generator
     */
    async function* nodeStreamToIterator(stream: fs.ReadStream) {
        for await (const chunk of stream) {
            yield chunk;
        }
    }
    /**
     * Taken from Next.js doc
     * https://nextjs.org/docs/app/building-your-application/routing/router-handlers#streaming
     * Itself taken from mozilla doc
     * https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream#convert_async_iterator_to_stream
     * @param {*} iterator 
     * @returns {ReadableStream}
     */
    function iteratorToStream(iterator: AsyncGenerator<any>) {
        return new ReadableStream({
            async pull(controller) {
                const { value, done } = await iterator.next()
    
                if (done) {
                    controller.close()
                } else {
    
                    controller.enqueue(new Uint8Array(value))
                }
            },
        })
    }
    resolvePath = async (source: PathSource) => {
        const mime = require('mime-types')
        const filehandle = require('node:fs/promises')
        const fd = await filehandle.open(source.path, 'r')
        const stream = fd.createReadStream()
        const iterator = nodeStreamToIterator(stream)
        const webStream = iteratorToStream(iterator)

        const mimeType = mime.lookup(source.path) || 'application/octet-stream'
        return {
            stream: webStream,
            mimeType: mimeType
        }
    }
}
