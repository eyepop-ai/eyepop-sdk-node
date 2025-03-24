import { Logger } from 'pino'
import { HttpClient } from '../options'

export let createHttpClient: (logger: Logger) => Promise<HttpClient>

function logLineFromRequest(input: RequestInfo | URL, init?: RequestInit): string {
    const url = input instanceof Request? input.url : input;
    const method = (input instanceof Request)? input.method : (init?.method || (init?.body !== undefined? 'POST': 'GET'));
    return `${method} ${url}`;
}

if ('document' in globalThis && 'implementation' in globalThis.document) {
    class BrowserHttpClient {
        private readonly _logger: Logger
        constructor(logger: Logger) {
            this._logger = logger;
        }

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const logLine = logLineFromRequest(input, init);
            this._logger.debug(`Browser fetch() BEFORE ${logLine}`)
            const response = await fetch(input, init)
            this._logger.debug(`AFTER ${logLine} -> ${response.status}`)
            return response;
        }

        public async close(): Promise<void> {}
        public isFullDuplex() {
            return false
        }
    }

    createHttpClient = async (logger: Logger) => {
        return new BrowserHttpClient(logger)
    }
} else {
    class NodeHttpClient {
        private readonly _agent: any
        private readonly _logger: Logger
        constructor(agent: any, logger: Logger) {
            this._agent = agent
            this._logger = logger;
        }

        public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            init ||= {}
            // @ts-ignore
            init.dispatcher = this._agent
            const logLine = logLineFromRequest(input, init);
            this._logger.debug(`Node fetch() BEFORE ${logLine}`)
            const response = await fetch(input, init)
            this._logger.debug(`AFTER ${logLine} -> ${response.status}`)
            return response;
        }

        public async close(): Promise<void> {
            return this._agent.close()
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
        return new NodeHttpClient(agent, logger)
    }
}
