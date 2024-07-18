import {PathSource, StreamSource} from "EyePop";

export let resolvePath: (source: PathSource) => Promise<StreamSource>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    resolvePath = async (source: PathSource) => {
        throw new DOMException("resolving a path to a file is not supported in browser")
    }
} else {
    resolvePath = async (source: PathSource) => {
        const mime = require('mime-types')
        const filehandle = require('node:fs/promises')
        const fd = await filehandle.open(source.path, 'r')
        const stream = fd.createReadStream()
        const mimeType = mime.lookup(source.path) || 'application/octet-stream'
        return {
            stream: stream,
            mimeType: mimeType
        }
    }
}
