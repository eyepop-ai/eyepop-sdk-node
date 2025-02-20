export interface HttpClient {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    close(): Promise<void>
}

export let createHttpClient: () => Promise<HttpClient>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class BrowserHttpClient {
        constructor() {}

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
    }

    createHttpClient = async () => {
        console.debug('EyePop: creating HttpClient in browser')
        return new BrowserHttpClient()
    }
} if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    class ReactNativeHttpClient {
        constructor() {}

        public async fetch(input: RequestInfo | URL, init?: any): Promise<Response> {
            init ||= {}
            init.reactNative = { textStreaming: true }
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
    }

    createHttpClient = async () => {
        console.debug('EyePop: creating HttpClient in ReactNative')
        return new ReactNativeHttpClient()
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
    }

    createHttpClient = async () => {
        console.debug('EyePop: creating HttpClient with undici agent in Node')
        const undici = require('undici')
        const agent = new undici.Agent({
            keepAliveTimeout: 10000,
            connections: 5,
            // two parallel streaming requests to the same host seem to deadlock with pipelining > 0
            pipelining: 0,
        })
        return new NodeHttpClient(agent)
    }
}
