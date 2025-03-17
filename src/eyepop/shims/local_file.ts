import * as fs from 'node:fs'
import { PathSource, StreamSource } from '../index'
import { Logger } from 'pino'

export let resolvePath: (source: PathSource, logger: Logger) => Promise<StreamSource>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    resolvePath = async (source: PathSource, logger: Logger) => {
        throw new DOMException('resolving a path to a file is not supported in browser')
    }
} else if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    let RNFSName = 'react-native-fs'
    let RNFS: any
    let RNFSLoadError: any
    try {
        RNFS = require(RNFSName)
    } catch (e) {
        RNFSLoadError = e
    }

    let EFSName = 'expo-file-system'
    let EFS: any
    let EFSLoadError: any
    try {
        EFS = require(EFSName)
    } catch (e) {
        EFSLoadError = e
    }

    resolvePath = async (source: PathSource, logger: Logger) => {
        if (RNFS?.read !== undefined) {
            logger.debug('Using react-native-fs to read local file')
            const bufferSize = 1024 * 1024 // 1MB buffer size
            let pos = 0
            let eof = false

            const stream = new ReadableStream({
                async pull(controller) {
                    if (eof) {
                        controller.close()
                        return
                    }

                    try {
                        const chunk = await RNFS.read(source.path, bufferSize, pos, 'base64')
                        if (chunk.length === 0) {
                            eof = true
                            controller.close()
                            return
                        }

                        const buffer = Buffer.from(chunk, 'base64')
                        controller.enqueue(buffer)
                        pos += buffer.length
                    } catch (error) {
                        console.error('Error reading chunk:', error)
                        controller.error(error)
                    }
                },
            })

            const stats = await RNFS.stat(source.path)

            return {
                stream: stream,
                size: stats.size,
                mimeType: source.mimeType || 'image/*',
            }
        } else if (EFS?.readAsStringAsync !== undefined) {
            logger.debug('Using expo-file-system to read local file')
            const bufferSize = 1024 * 1024
            let pos = 0
            let eof = false
            const stream = new ReadableStream({
                async pull(controller: any) {
                    if (eof) {
                        return
                    }
                    const chunkAsB64 = await EFS.readAsStringAsync(`file://${source.path}`, {
                        length: bufferSize,
                        position: pos,
                        encoding: 'base64',
                    })
                    if (chunkAsB64) {
                        const chunk = Buffer.from(chunkAsB64, 'base64')
                        controller.enqueue(chunk)
                        pos += chunk.length
                    } else {
                        eof = true
                        controller.close()
                    }
                },
            })
            return {
                stream: stream,
                size: (await EFS.getInfoAsync(`file://${source.path}`)).size,
                mimeType: source.mimeType || 'image/*',
            }
        }

        logger.debug('Using fetch to read local file')
        const response = await fetch(`file://${source.path}`)
        const reader = response.body?.getReader()
        const stream = new ReadableStream({
            async pull(controller) {
                if (!reader) {
                    controller.close()
                    return
                }

                try {
                    const { done, value } = await reader.read()

                    if (done) {
                        controller.close()
                        return
                    }

                    controller.enqueue(value)
                } catch (error) {
                    console.error('Error reading chunk:', error)
                    controller.error(error)
                }
            },
        })

        return {
            stream: stream,
            size: response.headers.get('content-length'),
            mimeType: response.headers.get('content-type') || source.mimeType || 'image/*',
        }
    }
} else {
    /**
     * From https://github.com/MattMorgis/async-stream-generator
     */
    async function* nodeStreamToIterator(stream: fs.ReadStream) {
        for await (const chunk of stream) {
            yield chunk
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
    resolvePath = async (source: PathSource, logger: Logger) => {
        const mime = require('mime-types')
        const filehandle = require('node:fs/promises')
        const fd = await filehandle.open(source.path, 'r')
        const stream = fd.createReadStream()
        const iterator = nodeStreamToIterator(stream)
        const webStream = iteratorToStream(iterator)

        const mimeType = source.mimeType ? source.mimeType : mime.lookup(source.path) || 'image/*'
        return {
            stream: webStream,
            mimeType: mimeType,
        }
    }
}
