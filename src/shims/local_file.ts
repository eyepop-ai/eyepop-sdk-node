import {UploadParams} from "EyePopSdk/types";

export let resolve: (params: UploadParams) => Promise<UploadParams>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    const isFileLike = (value:any) => value != null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.lastModified === 'number';

    resolve = async (params: UploadParams) => {
        if (params.file) {
            if (isFileLike(params.file)) {
                params = {
                    mimeType: params.file.type,
                    file: params.file
                }
                return params
            }
        }
        throw new DOMException("resolving a path to a file is not supported in browser")
    }

} else {
    resolve = async (params: UploadParams) => {
        if (params.file) {
            return params
        }

        const mime = await import('mime-types')
        const fs = await import('node:fs')

        let mimeType: string | undefined
        let stream: any | undefined

        if (params.filePath) {
            if (params.mimeType) {
                mimeType = params.mimeType
            } else {
                mimeType = mime.lookup(params.filePath) || undefined
            }
            stream = fs.createReadStream(params.filePath)
        }

        params = {
            filePath: params.filePath,
            mimeType: mimeType,
            file: stream
        }
        return params
    }
}
