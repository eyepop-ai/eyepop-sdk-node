import { Logger } from 'pino'
import { Session } from './types'
import { PathSource, StreamSource } from 'EyePop/worker/worker_types'

export interface Auth0Options {
    domain: string
    clientId: string
    audience: string
    scope: string
}

export interface ApiKeyAuth {
    /**
     * Authentication api key for server side execution.
     * Defaults to process.env['EYEPOP_API_KEY'].
     */
    apiKey: string
}

export interface SessionAuth {
    /**
     * Temporary authentication token for client side execution.
     */
    session: Session
}

export interface OAuth2Auth {
    /**
     * For development mode, authenticate with your dashboard.eyepop.ai account
     */
    oAuth2: true | Auth0Options
}

export interface LocalAuth {
    /**
     * Implicit auth w/o credentials to a local endpoint.
     */
    isLocal: true
}

export type Authentication = undefined | ApiKeyAuth | SessionAuth | OAuth2Auth | LocalAuth

export interface HttpClient {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
    close(): Promise<void>
    isFullDuplex(): boolean
}

export interface PlatformSupport {
    createHttpClient?: (logger: Logger) => Promise<HttpClient>
    resolvePath: (source: PathSource, logger: Logger) => Promise<StreamSource>
}

export interface Options {
    auth?: Authentication | undefined

    /**
     * Override the default base URL for the API, e.g., "https://api.eyepop.ai/"
     *
     * Defaults to process.env['EYEPOP_URL'].
     */
    eyepopUrl?: string

    jobQueueLength?: number

    logger?: Logger | undefined

    platformSupport?: PlatformSupport
}
