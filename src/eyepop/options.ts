import { Logger } from 'pino'
import { Session } from './types'
import { PathSource, StreamSource } from './worker/worker_types'

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

export interface AccessTokenAuth {
    /**
     * Bearer token accepted by the compute API.
     */
    accessToken: string
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

export type Authentication = undefined | ApiKeyAuth | AccessTokenAuth | SessionAuth | OAuth2Auth | LocalAuth

export function resolveAuth(options: Options): Authentication {
    if (options.apiKey !== undefined) {
        return { apiKey: options.apiKey }
    }
    if (options.accessToken !== undefined) {
        return { accessToken: options.accessToken }
    }
    if (options.session !== undefined) {
        return { session: options.session }
    }
    if (options.oAuth2 !== undefined) {
        return { oAuth2: options.oAuth2 }
    }
    return options.auth
}

export function bearerCredential(auth: Authentication): string | undefined {
    if (auth === undefined) {
        return undefined
    }
    const apiKey = (auth as ApiKeyAuth).apiKey
    if (apiKey !== undefined) {
        return apiKey
    }
    return (auth as AccessTokenAuth).accessToken
}

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
    /**
     * Authentication api key for server side execution.
     * Defaults to process.env['EYEPOP_API_KEY'].
     */
    apiKey?: string | undefined

    /**
     * Bearer token accepted by the compute API.
     */
    accessToken?: string | undefined

    /**
     * Temporary authentication token for client side execution.
     */
    session?: Session | undefined

    /**
     * For development mode, authenticate with your dashboard.eyepop.ai account
     */
    oAuth2?: true | Auth0Options | undefined

    /**
     * @deprecated Pass apiKey, accessToken, session, or oAuth2 at the top level.
     */
    auth?: Authentication | undefined

    eyepopUrl?: string | undefined

    jobQueueLength?: number

    logger?: Logger | undefined

    platformSupport?: PlatformSupport
}
