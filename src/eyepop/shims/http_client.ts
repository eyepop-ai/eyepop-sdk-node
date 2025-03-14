import { reactNativeStreamingFetch } from './rn_streaming_fetch'
import { Logger } from 'pino'

export interface HttpClient {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    close(): Promise<void>
    isFullDuplex(): boolean
}

export let createHttpClient: (logger: Logger) => Promise<HttpClient>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class BrowserHttpClient {
        constructor() {}

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
        public isFullDuplex() { return false; }
    }

    createHttpClient = async (logger: Logger) => {
        logger.debug("Using browser fetch as http client");
        return new BrowserHttpClient();
    }
} else if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    let RNName = 'react-native';
    let RN: any
    let TcpSocketsName = 'react-native-tcp-socket';
    let TcpSockets: any
    let TcpSocketsError: any
    try {
        RN = require(RNName);
        TcpSockets = require(TcpSocketsName);
        if (TcpSockets?.TLSSocket) {
            // @ts-ignore
            if (!RN?.NativeModules?.TcpSockets) {
                TcpSockets = undefined
                throw Error(`'${TcpSocketsName}' but not symbol NativeModules?.TcpSockets, `+
                    'native sockets not available when running \'npx expo start\', ' +
                    'use \'npx expo run:android\' or \'npx expo run:ios\' instead')
            }
        }
    } catch (e) {
        TcpSocketsError = e
    }

    class ReactNativeHttpClient {
        private readonly logger: Logger;
        constructor(logger: Logger) {
            this.logger = logger;
        }

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            init ||= {}
            let streamBody: ReadableStream<Uint8Array> | undefined
            if (input instanceof Request) {
                if (input.body instanceof ReadableStream) {
                    streamBody = input.body
                }
            } else if (init?.body instanceof ReadableStream) {
                streamBody = init.body
            }
            if (streamBody) {
                if (TcpSockets?.TLSSocket !== undefined) {
                    let url: URL
                    let method: string
                    let headers: Headers
                    if (input instanceof Request) {
                        url = new URL(input.url)
                        method = input.method
                        headers = input.headers
                    } else {
                        if (input instanceof URL) {
                            url = input
                        } else {
                            url = new URL(input)
                        }
                        method = init?.method || "POST"
                        headers = new Headers(init?.headers)
                    }
                    let contentLength = undefined
                    if (headers.has('content-length')) {
                        contentLength = parseInt(headers.get('content-length') || "")
                    } else {
                        headers.append("Transfer-Encoding", "chunked")
                    }

                    return await reactNativeStreamingFetch(
                        url, method, headers, streamBody, contentLength, TcpSockets, this.logger
                    );
                } else {
                    this.logger.warn(`[${TcpSockets}] Could not load '${TcpSocketsName}' (reason: ${TcpSocketsError}), ` +
                        'include this package in your application to enable streamed uploads; without this package ' +
                        'local files have to be loaded into memory uploading and this will cause Out-Of-Memory errors ' +
                        'for large files.')
                    try {
                        const chunks = []
                        const reader = streamBody.getReader();
                        while (true) {
                            const { done, value } = await reader.read()
                            if (done) {
                                break;
                            }
                            chunks.push(value);
                        }
                        if (input instanceof Request) {
                            input = new Request(input, { body: Buffer.concat(chunks) })
                        } else {
                            init.body = Buffer.concat(chunks);
                        }
                    } catch (e) {
                        return Promise.reject(e);
                    }
                }
            }

            // @ts-ignore
            init.reactNative = { textStreaming: true }
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
        public isFullDuplex() { return true; }
    }
    createHttpClient = async (logger: Logger) => {
        logger.debug("using React Native fetch and will attempt direct sockets communication for uploads to " +
            "workaround the missing request body streaming support in React Native.")
        return new ReactNativeHttpClient(logger)
    }
} else {
    class NodeHttpClient {
        private readonly agent: any
        constructor(agent: any) {
            this.agent = agent
        }

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            init ||= {}
            // @ts-ignore
            init.dispatcher = this.agent
            return await fetch(input, init)
        }

        public async close(): Promise<void> {
            return this.agent.close()
        }
        public isFullDuplex() { return false; }
    }

    createHttpClient = async (logger: Logger) => {
        const undici = require('undici')
        const agent = new undici.Agent({
            keepAliveTimeout: 10000,
            connections: 5,
            // two parallel streaming requests to the same host seem to deadlock with pipelining > 0
            pipelining: 0,
        })
        logger.debug("Using node fetch with undici agent as http client")
        return new NodeHttpClient(agent)
    }
}
