import type { HttpClient } from '../options'
import type { Pop } from '../worker/worker_types'

export enum SessionStatus {
    UNKNOWN = 'unknown',
    PENDING = 'pending',
    RUNNING = 'running',
    STOPPED = 'stopped',
    FAILED = 'failed',
    ERROR = 'error',

    PIPELINE_CREATING = 'pipeline_creating',
    PIPELINE_OK = 'pipeline_ok',
    PIPELINE_CHECKING = 'pipeline_checking',
    PIPELINE_ERROR = 'pipeline_error',
    UPGRADING = 'upgrading',
}

export interface ComputeSession {
    session_uuid: string
    session_endpoint: string
    pipeline_uuid: string
    access_token?: string
    access_token_expires_at?: string
    access_token_expires_in?: number
    session_status: SessionStatus
    session_message: string
    session_name: string
    user_uuid: string
    created_at: string
    uptime: number
    pipeline_ttl?: number | undefined
    session_active: boolean
    persistent?: boolean
    pipelines?: { id?: string; pipeline_id?: string }[]
    pipeline_error?: ComputeErrorInfo
}

export interface ComputeErrorInfo {
    code?: string
    message?: string
    details?: string
}

export interface ResolvedComputeSession {
    session: ComputeSession
    pipelineId: string | null
    accessToken: string
    accessTokenValidUntil: number | null
}

export interface ComputeSessionClientOptions {
    computeUrl: string
    httpClient: HttpClient
    authorizationHeader: () => Promise<string>
    sessionUuid?: string | undefined
    sessionName?: string | undefined
    pipelineImage?: string | undefined
    pipelineVersion?: string | undefined
    pop?: Pop | undefined
    readyTimeoutMs: number
    logger?: Pick<Console, 'debug'>
    requestLogger?: Pick<Console, 'debug'>
}

const SESSION_DEAD = new Set<SessionStatus>([SessionStatus.ERROR, SessionStatus.FAILED, SessionStatus.STOPPED, SessionStatus.PIPELINE_ERROR, SessionStatus.UNKNOWN])

const CHECK_FOR_IS_READY_INTERVAL = 250

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function pipelineIdFromSession(session: ComputeSession): string | null {
    if (session.pipeline_uuid) {
        return session.pipeline_uuid
    }
    const pipeline = session.pipelines?.[0]
    return pipeline?.id || pipeline?.pipeline_id || null
}

function sessionCreateBody(options: ComputeSessionClientOptions): string | undefined {
    const body: any = {}
    if (options.sessionName) {
        body.session_name = options.sessionName
    }
    if (options.pipelineImage) {
        body.pipeline_image = options.pipelineImage
    }
    if (options.pipelineVersion) {
        body.pipeline_version = options.pipelineVersion
    }
    if (options.pop) {
        body.pop = options.pop
    }
    return Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
}

function sessionHealthReady(body: string, contentType: string): boolean {
    if (contentType.includes('application/json')) {
        const health = JSON.parse(body)
        if (health && typeof health == 'object') {
            if (health.message && !health.session_status) {
                return true
            }
            return health.session_status == SessionStatus.RUNNING
        }
    }
    return contentType.includes('text/plain') && body.includes("I'm fine")
}

function accessTokenValidUntil(session: ComputeSession): number | null {
    if (session.access_token_expires_at) {
        const expiresAt = Date.parse(session.access_token_expires_at)
        return Number.isNaN(expiresAt) ? null : expiresAt
    }
    if (session.access_token_expires_in) {
        return Date.now() + session.access_token_expires_in * 1000
    }
    return null
}

function errorInfoMessage(errorInfo: ComputeErrorInfo): string {
    return [errorInfo.code, errorInfo.message, errorInfo.details].filter((part): part is string => typeof part == 'string' && part.length > 0).join(': ')
}

function pipelineErrorMessage(session: ComputeSession): string | null {
    if (session.pipeline_error) {
        const message = errorInfoMessage(session.pipeline_error)
        return message ? `Pipeline failed for compute session ${session.session_uuid}: ${message}` : `Pipeline failed for compute session ${session.session_uuid}`
    }
    if (session.session_status == SessionStatus.PIPELINE_ERROR) {
        return `Pipeline failed for compute session ${session.session_uuid}`
    }
    return null
}

async function responseErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
        try {
            const parsed = normalizedJsonValue(await response.clone().json())
            const message = normalizedErrorMessage(parsed)
            if (message) {
                return message
            }
        } catch (_) {}
    }
    const body = await response.text()
    const message = normalizedErrorMessage(body)
    return message || body
}

function normalizedJsonValue(value: unknown): unknown {
    if (typeof value == 'string') {
        try {
            const parsed = JSON.parse(value)
            return normalizedJsonValue(parsed)
        } catch (_) {
            const unescaped = value.replace(/\\"/g, '"')
            if (unescaped != value) {
                try {
                    const parsed = JSON.parse(unescaped)
                    return normalizedJsonValue(parsed)
                } catch (_) {}
            }
            return value
        }
    }
    return value
}

async function responseJson<T>(response: Response): Promise<T> {
    return normalizedJsonValue(await response.json()) as T
}

function normalizedErrorMessage(value: unknown): string | null {
    value = normalizedJsonValue(value)

    if (typeof value == 'string') {
        return value
    }
    if (!value || typeof value != 'object') {
        return null
    }

    const record = value as Record<string, unknown>
    const normalizedError = normalizedJsonValue(record['error'])
    const errorMessage = normalizedErrorMessage(normalizedError) || (typeof normalizedError == 'string' ? normalizedError : null)
    const message = [record['code'], errorMessage, record['message'], record['details']].filter((part): part is string => typeof part == 'string' && part.length > 0).join(': ')
    if (message) {
        return message
    }

    if (record['pipeline_error']) {
        return normalizedErrorMessage(record['pipeline_error'])
    }

    if (normalizedError && typeof normalizedError == 'object') {
        return normalizedErrorMessage(normalizedError)
    }

    try {
        return JSON.stringify(value)
    } catch (_) {
        return null
    }
}

export class ComputeSessionClient {
    constructor(private readonly options: ComputeSessionClientOptions) {}

    public async resolve(): Promise<ResolvedComputeSession> {
        const session = this.options.sessionUuid ? await this.getPermanentComputeSession(this.options.sessionUuid) : await this.getOnDemandComputeSession()
        const pipelineFailure = pipelineErrorMessage(session)
        if (pipelineFailure) {
            throw new Error(pipelineFailure)
        }
        const accessToken = this.sessionAccessToken(session)
        await this.waitUntilReady(session, accessToken)
        const pipelineId = pipelineIdFromSession(session)
        if (this.options.pop && !pipelineId) {
            throw new Error('Compute session did not provide a pipeline for the requested pop')
        }
        return {
            session,
            pipelineId,
            accessToken,
            accessTokenValidUntil: accessTokenValidUntil(session),
        }
    }

    private async getOnDemandComputeSession(): Promise<ComputeSession> {
        let session: ComputeSession | null = null

        const sessionsUrl = `${this.options.computeUrl}/v1/sessions`
        const headers = {
            Authorization: await this.options.authorizationHeader(),
        }
        let sessions: ComputeSession[]

        if (!this.options.pop) {
            this.options.requestLogger?.debug('fetching sessions from: %s', sessionsUrl)
            const response = await this.options.httpClient.fetch(sessionsUrl, {
                headers: headers,
            })

            if (response.status == 404) {
                sessions = []
            } else if (response.status != 200) {
                const message = await responseErrorMessage(response)
                throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
            } else {
                const response_content = await responseJson<ComputeSession[]>(response)
                sessions = response_content as ComputeSession[]
            }
            if (sessions.length > 0) {
                this.options.logger?.debug(`User has ${sessions.length} sessions, inspecting for usable session`)
                for (let s of sessions) {
                    if (!SESSION_DEAD.has(s.session_status) && !s.persistent && (!this.options.sessionName || s.session_name === this.options.sessionName)) {
                        session = s
                        this.options.logger?.debug(`Use active session ${s.session_uuid} with pipeline ${pipelineIdFromSession(s)}`)
                        break
                    }
                }
            }
        }
        if (!session) {
            this.options.requestLogger?.debug('creating a new session at: %s', sessionsUrl)
            const createBody = sessionCreateBody(this.options)
            const createHeaders = {
                ...headers,
                ...(createBody ? { 'Content-Type': 'application/json' } : {}),
            }
            const request: RequestInit = {
                headers: createHeaders,
                method: 'POST',
            }
            if (createBody) {
                request.body = createBody
            }
            const query = 'wait=true'
            const response = await this.options.httpClient.fetch(`${sessionsUrl}?${query}`, request)
            if (response.status != 200) {
                const message = await responseErrorMessage(response)
                throw new Error(`Unexpected status ${response.status} creating a compute session: ${message}`)
            } else {
                sessions = await responseJson<ComputeSession[]>(response)
            }
            if (sessions.length == 0) {
                throw new Error('Unexpected, no compute session after attempt to create one')
            }
            session = sessions[0] || null
        }
        if (!session) {
            throw new Error('unexpected undefined session')
        }
        return session
    }

    private async getPermanentComputeSession(sessionUuid: string): Promise<ComputeSession> {
        let session: ComputeSession | null = null

        const sessionUrl = `${this.options.computeUrl}/v1/sessions/${sessionUuid}`
        this.options.requestLogger?.debug('fetching session from: %s', sessionUrl)
        const headers = {
            Authorization: await this.options.authorizationHeader(),
        }
        let response = await this.options.httpClient.fetch(sessionUrl, {
            headers: headers,
        })
        if (response.status == 404) {
            throw new Error(`Unexpected status ${response.status} compute sessions ${sessionUuid} not found`)
        } else if (response.status != 200) {
            const message = await responseErrorMessage(response)
            throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
        } else {
            const response_content = await responseJson<ComputeSession>(response)
            session = response_content as ComputeSession
        }
        return session
    }

    private sessionAccessToken(session: ComputeSession): string {
        if (!session.access_token) {
            throw new Error(`Compute session ${session.session_uuid} did not provide an access token`)
        }
        return session.access_token
    }

    private async waitUntilReady(session: ComputeSession, accessToken: string): Promise<void> {
        let isReady: boolean = false
        const deadline: number = Date.now() + this.options.readyTimeoutMs
        while (!isReady) {
            const health_url = `${session.session_endpoint}/health`
            const response = await this.options.httpClient.fetch(health_url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                },
            })
            if (response.status == 200) {
                const contentType = response.headers.get('content-type') || ''
                const body = await response.text()
                try {
                    isReady = sessionHealthReady(body, contentType)
                } catch (error) {
                    this.options.logger?.debug(`session ${session.session_uuid} health check returned invalid JSON, wait and poll for update`)
                }
                if (!isReady && Date.now() > deadline) {
                    throw new Error(`Created session ${session.session_uuid} did not become healthy after ${this.options.readyTimeoutMs / 1000} seconds`)
                }
                if (!isReady) {
                    this.options.logger?.debug(`session ${session.session_uuid} health check not ready, wait and poll for update`)
                    await sleep(CHECK_FOR_IS_READY_INTERVAL)
                }
            } else if (Date.now() > deadline) {
                throw new Error(`Created session ${session.session_uuid} did not become healthy after ${this.options.readyTimeoutMs / 1000} seconds`)
            } else {
                this.options.logger?.debug(`session ${session.session_uuid} health check status ${response.status}, wait and poll for update`)
                await sleep(CHECK_FOR_IS_READY_INTERVAL)
            }
        }
    }
}
