export interface HttpClient {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    close(): Promise<void>
    isFullDuplex(): boolean
}

export let createHttpClient: () => Promise<HttpClient>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class BrowserHttpClient {
        constructor() {}

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
        public isFullDuplex() { return false; }
    }

    createHttpClient = async () => {
        return new BrowserHttpClient()
    }
} else if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    class ReactNativeHttpClient {
        constructor() {
        }

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            init ||= {}
            // @ts-ignore
            init.reactNative = { textStreaming: true }
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
        public isFullDuplex() { return true; }
    }
    createHttpClient = async () => {
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
        public isFullDuplex() { return false; }
    }

    createHttpClient = async () => {
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
