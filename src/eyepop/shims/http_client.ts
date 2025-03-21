import { Logger } from 'pino'
import { HttpClient } from '../options'

export let createHttpClient: (logger: Logger) => Promise<HttpClient>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class BrowserHttpClient {
        constructor() {}

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            return await fetch(input, init)
        }

        public async close(): Promise<void> {}
        public isFullDuplex() {
            return false
        }
    }

    createHttpClient = async (logger: Logger) => {
        logger.debug('Using browser fetch as http client')
        return new BrowserHttpClient()
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
        public isFullDuplex() {
            return false
        }
    }

    createHttpClient = async (logger: Logger) => {
        const undici = require('undici')
        const agent = new undici.Agent({
            keepAliveTimeout: 10000,
            connections: 5,
            // two parallel streaming requests to the same host seem to deadlock with pipelining > 0
            pipelining: 0,
        })
        logger.debug('Using node fetch with undici agent as http client')
        return new NodeHttpClient(agent)
    }
}
