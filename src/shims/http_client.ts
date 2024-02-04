
export interface HttpClient {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    close(): Promise<void>
}

export let createHttpClient: () => Promise<HttpClient>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class HttpClient {
        constructor() {
        }

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            return fetch(input, init)
        }

        public async close(): Promise<void> {

        }
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
            return fetch(input, init)
        }

        public async close(): Promise<void> {
            return this.agent.close()
        }
    }

    createHttpClient = async () => {
        const undici = await import('undici')
        const agent = new undici.Agent({
            keepAliveTimeout: 10000,
            connections: 5
        })
        return new HttpClient(agent)
    }
}
