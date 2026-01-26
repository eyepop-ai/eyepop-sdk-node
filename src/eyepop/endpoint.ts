import { Auth0Options, HttpClient, LocalAuth, OAuth2Auth, Options, ApiKeyAuth, SessionAuth } from './options'
import { EndpointState, Session } from './types'
import { createHttpClient } from './shims/http_client'
import { Semaphore } from './semaphore'

import { Logger, pino } from 'pino'
import { authenticateBrowserSession } from './shims/browser_session'

interface AccessToken {
    access_token: string
    expires_in: number
    token_type: string
}

export class Endpoint<T extends Endpoint<T>> {
    protected _options: Options
    private _token: string | null
    private _expire_token_time: number | null

    protected _client: HttpClient | null
    private _statusRetryHandlers: Map<number, Function>

    protected _limit: Semaphore
    private _state: EndpointState
    private _message: null | string
    private _stateChangeHandler: null | ((fromState: EndpointState, toState: EndpointState) => void)

    protected _logger: Logger
    protected readonly _requestLogger: Logger

    constructor(options: Options) {
        this._options = options
        this._token = null
        this._expire_token_time = null
        this._client = null
        this._statusRetryHandlers = new Map()
        this._statusRetryHandlers.set(401, this.statusHandler401)

        this._limit = new Semaphore(this._options.jobQueueLength ?? 1024)
        this._state = EndpointState.Idle
        this._message = null
        this._stateChangeHandler = null

        let rootLogger
        if (options.logger) {
            rootLogger = options.logger
        } else {
            rootLogger = pino()
        }
        this._logger = rootLogger.child({ module: 'eyepop' })
        this._requestLogger = this._logger.child({ module: 'requests' })
    }

    protected setStatusRetryHandlers(statusRetryHandlers: Map<number, Function> | undefined = undefined) {
        this._statusRetryHandlers = new Map(statusRetryHandlers)
        this._statusRetryHandlers.set(401, this.statusHandler401)
    }

    public eyepopUrl(): string {
        if (this._options.eyepopUrl) {
            return this._options.eyepopUrl.replace(/\/+$/, '')
        } else {
            return 'https://compute.eyepop.ai'
        }
    }

    // TODO: deprecated Web API endpoint needed for POP_ID support
    public eyepopWebApiUrl(): string {
        if (this._options.eyepopUrl) {
            return this._options.eyepopUrl.replace(/\/+$/, '').replace(/compute\./, 'web-api.')
        } else {
            return 'https://api.eyepop.ai'
        }
    }

    public pendingJobs(): number {
        return (this._options.jobQueueLength ?? 1024) - this._limit.getPermits()
    }

    public state(): EndpointState {
        return this._state
    }

    public lastMessage(): string | null {
        return this._message
    }

    public onStateChanged(handler: (fromState: EndpointState, toState: EndpointState) => void): T {
        this._stateChangeHandler = handler
        return <T>(<unknown>this)
    }

    protected updateState(newState: EndpointState | undefined = undefined, message: string | undefined = undefined) {
        const fromState = this._state
        if (newState == undefined) {
            if (this._limit.getPermits() == this._options.jobQueueLength) {
                newState = EndpointState.Idle
            } else {
                newState = EndpointState.Busy
            }
        }
        this._state = newState
        this._message = message ? message : null

        if (this._stateChangeHandler) {
            this._stateChangeHandler(fromState, this._state)
        }
    }

    public async connect(): Promise<T> {
        if (this._client) {
            this._logger.warn('endpoint already connected')
            return <T>(<unknown>this)
        }
        if (!this._options.eyepopUrl) {
            return Promise.reject('option eyepopUrl or environment variable EYEPOP_URL is required')
        }
        if (this._options.auth === undefined) {
            return Promise.reject('cannot connect without defined auth option')
        }
        if ((this._options.auth as SessionAuth).session !== undefined) {
            this._token = (this._options.auth as SessionAuth).session.accessToken
            this._expire_token_time = (this._options.auth as SessionAuth).session.validUntil / 1000
        } else if ((this._options.auth as OAuth2Auth).oAuth2 !== undefined) {
        } else if ((this._options.auth as ApiKeyAuth).apiKey !== undefined) {
        } else if ((this._options.auth as LocalAuth).isLocal !== undefined) {
        } else {
            return Promise.reject('option apiKey or environment variable EYEPOP_API_KEY is required')
        }

        if (this._options.platformSupport?.createHttpClient !== undefined) {
            this._client = await this._options.platformSupport.createHttpClient(this._requestLogger)
        } else {
            this._client = await createHttpClient(this._requestLogger)
        }

        return await this.reconnect()
    }

    public async disconnect(wait: boolean = true): Promise<void> {
        if (wait && this._limit) {
            // @ts-ignore
            for (let j = 0; j < this._options.jobQueueLength; j++) {
                await this._limit.acquire()
            }
        }

        this._limit = new Semaphore(this._options.jobQueueLength ?? 1024)

        if (this._client) {
            await this._client.close()
            this._client = null
        }
    }

    public async session(): Promise<Session> {
        await this.currentAccessToken()
        if (this._token == null || this._expire_token_time == null) {
            return Promise.reject('endpoint not connected')
        }
        return {
            eyepopUrl: <string>this._options.eyepopUrl,
            accessToken: this._token,
            validUntil: this._expire_token_time * 1000,
        }
    }

    protected statusHandler401(statusCode: number): void {
        this._token = null
        this._expire_token_time = null
    }

    protected async fetchWithRetry(fetcher: () => Promise<Response>, retries: number = 1): Promise<Response> {
        while (true) {
            try {
                const response = await fetcher()
                if (response.ok) {
                    return response
                } else {
                    const handler = this._statusRetryHandlers.get(response.status)
                    if (handler != null) {
                        handler(response.status)
                        if (retries--) {
                            this._requestLogger.info('received %d response, retry', response.status)
                        } else {
                            return response
                        }
                    } else {
                        return response
                    }
                }
            } catch (error) {
                // handle connection errors like 404s
                const handler = this._statusRetryHandlers.get(404)
                if (handler != null) {
                    handler(error)
                    if (retries--) {
                        this._requestLogger.info('error %s, retry', error)
                    } else {
                        return Promise.reject(`error ${error}`)
                    }
                } else {
                    return Promise.reject(`error ${error}`)
                }
            }
        }
    }

    protected async reconnect(): Promise<T> {
        throw new Error('reconnect() not implemented')
    }

    protected async authorizationHeader(): Promise<string> {
        if ((this._options.auth as LocalAuth).isLocal !== undefined) {
            return `Implicit`
        }
        return `Bearer ${await this.currentAccessToken()}`
    }

    private async currentAccessToken(): Promise<string> {
        const now = Date.now() / 1000
        if (!this._token || <number>this._expire_token_time < now) {
            this.updateState(EndpointState.Authenticating)
            try {
                if (!this._client) {
                    return Promise.reject('endpoint not connected')
                } else if ((this._options.auth as LocalAuth).isLocal !== undefined) {
                    this._token = "implicit"
                    this._expire_token_time = Number.MAX_VALUE
                } else if ((this._options.auth as SessionAuth).session !== undefined) {
                    return Promise.reject('temporary access token expired')
                } else if ((this._options.auth as OAuth2Auth).oAuth2 !== undefined && this._options.eyepopUrl) {
                    const session = await authenticateBrowserSession((this._options.auth as OAuth2Auth).oAuth2 as Auth0Options, this._options)
                    this._token = session.accessToken
                    this._expire_token_time = session.validUntil / 1000
                } else if ((this._options.auth as ApiKeyAuth).apiKey !== undefined && this._options.eyepopUrl) {
                    const headers = { 'Authorization': `Bearer ${(this._options.auth as ApiKeyAuth).apiKey}` }
                    const post_url = `${this.eyepopUrl()}/v1/auth/authenticate`
                    const response = await this._client.fetch(post_url, {
                        method: 'POST',
                        headers: headers,
                    })
                    if (response.status != 200) {
                        const message = await response.text()
                        return Promise.reject(`Unexpected status ${response.status}: ${message}`)
                    }
                    const data = await response.json()
                    const token: AccessToken = data as AccessToken
                    this._token = token.access_token
                    this._expire_token_time = now + token.expires_in - 60
                } else {
                    return Promise.reject('no valid auth option')
                }
            } finally {
                this.updateState()
            }
        }
        this._logger.debug('using access token, valid for at least %d seconds', <number>this._expire_token_time - now)
        return <string>this._token
    }
}
