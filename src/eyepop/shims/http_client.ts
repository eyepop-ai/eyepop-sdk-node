export interface HttpClient {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    close(): Promise<void>
}

export let createHttpClient: () => Promise<HttpClient>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class HttpClient {
        constructor() {}

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
    }

    createHttpClient = async () => {
        return new HttpClient()
    }
} else {
    class HttpClient {
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
        const undici = require('undici')
        const agent = new undici.Agent({
            keepAliveTimeout: 10000,
            connections: 5,
            // two parallel streaming requests to the same host seem to deadlock with pipelining > 0
            pipelining: 0,
        })
        return new HttpClient(agent)
    }
}
