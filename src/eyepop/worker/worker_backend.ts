import { Logger } from 'pino'
import { HttpClient } from '../options'
import { Semaphore } from '../semaphore'
import { EndpointState } from '../types'
import { WorkerOptions } from './worker_options'
import { Pop, ProcessParams, ResultStream, Source, WorkerSession } from './worker_types'

/**
 * What a job runs, whatever backend runs it: one source, or a group of paths, streams or urls
 * run as one inference unit, with its parameters.
 */
export type WorkerWork =
    | { readonly kind: 'source'; readonly source: Source; readonly params: ProcessParams }
    | { readonly kind: 'uploadGroup'; readonly paths: string[]; readonly params: ProcessParams }
    | {
          readonly kind: 'uploadStreamGroup'
          readonly streams: Array<ReadableStream<Uint8Array> | Blob | BufferSource>
          readonly mimeTypes: string[] | undefined
          readonly params: ProcessParams
      }
    | { readonly kind: 'loadFromGroup'; readonly urls: string[]; readonly params: ProcessParams }

/** What a backend may use of its endpoint: the options, the HTTP client, the credential and the job queue. */
export interface WorkerContext {
    readonly options: WorkerOptions
    readonly logger: Logger
    readonly requestLogger: Logger
    client(): HttpClient | null
    /** The job queue; a backend acquires a permit per job and releases it through `jobDone`. */
    limit(): Semaphore
    jobDone(): void
    updateState(state?: EndpointState, message?: string): void
    eyepopUrl(): string
    eyepopWebApiUrl(): string
    /** `Bearer <token>` for the endpoint's own credential, exchanged and refreshed as needed; `Implicit` locally. */
    credentialHeader(): Promise<string>
    /** Forget the endpoint's token, so the next `credentialHeader` authenticates again. */
    forgetCredential(): void
    fetchWithRetry(fetcher: () => Promise<Response>, retries?: number): Promise<Response>
    /** The endpoint's credential as a session. */
    credentialSession(): Promise<{ eyepopUrl: string; accessToken: string; validUntil: number }>
}

/**
 * What runs a WorkerEndpoint's jobs: a worker session, or the pipeline API's socket. The endpoint
 * owns the public methods and their checks, the credential, the HTTP client and the job queue; it
 * hands each job to its backend as a WorkerWork.
 */
export interface WorkerBackend {
    /** Reach whatever runs jobs; called when the endpoint connects. */
    reconnect(): Promise<void>
    /**
     * Release it when the endpoint disconnects. `closeEndpoint` waits for the endpoint's jobs (when
     * asked to) and closes its HTTP client; the backend calls it before or after releasing its own.
     */
    disconnect(closeEndpoint: () => Promise<void>): Promise<void>
    session(): Promise<WorkerSession>
    pop(): Pop | null
    popName(): string | null
    changePop(pop: Pop): Promise<void>
    /** Start the work and return its predictions; the backend holds a job queue permit until it ends. */
    submit(work: WorkerWork): Promise<ResultStream>
    /** A request answered with this status; a session backend forgets what it no longer reaches. */
    onStatus(statusCode: number): void
    /** The endpoint's Authorization header for the worker's routes. */
    authorizationHeader(): Promise<string>
}
