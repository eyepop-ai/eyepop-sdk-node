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

export class ComputeSessionClient {
    constructor(private readonly options: ComputeSessionClientOptions) {}

    public async resolve(): Promise<ResolvedComputeSession> {
        const session = this.options.sessionUuid ? await this.getPermanentComputeSession(this.options.sessionUuid) : await this.getOnDemandComputeSession()
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
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
            } else {
                const response_content = await response.json()
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
            const query = this.options.pop ? 'wait=true&transient=true' : 'wait=true'
            const response = await this.options.httpClient.fetch(`${sessionsUrl}?${query}`, request)
            if (response.status != 200) {
                const message = await response.text()
                throw new Error(`Unexpected status ${response.status} creating a compute session: ${message}`)
            } else {
                sessions = (await response.json()) as ComputeSession[]
            }
            if (sessions.length == 0) {
                throw new Error('Unexpected, no compute session after attempt to create one')
            }
            session = sessions[0] || null
        }
        if (!session) {
            throw new Error('unexpected undefined session')
        }
        if (this.options.pop && !pipelineIdFromSession(session)) {
            throw new Error('Compute session did not provide a pipeline for the requested pop')
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
            const message = await response.text()
            throw new Error(`Unexpected status ${response.status} fetching compute sessions: ${message}`)
        } else {
            const response_content = await response.json()
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
