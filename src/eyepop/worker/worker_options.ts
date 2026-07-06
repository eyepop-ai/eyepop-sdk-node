import { Options } from '../options'
import type { Pop } from './worker_types'

/**
 * @deprecated Configure transient sessions with `WorkerOptions.pop`.
 * Support for pop id will be removed in 3.16.
 */
export enum TransientPopId {
    Transient = 'transient',
}

export interface WorkerOptions extends Options {
    /**
     * @deprecated Pass `pop` for transient sessions or `sessionUuid` for persistent sessions.
     * Support for pop id will be removed in 3.16.
     */
    popId?: string | TransientPopId | undefined

    sessionUuid?: string | undefined
    sessionName?: string | undefined
    pipelineImage?: string | undefined
    pipelineVersion?: string | undefined
    pop?: Pop | undefined
    sessionReadyTimeoutSeconds?: number | undefined
    autoStart?: boolean
    stopJobs?: boolean
    isLocalMode?: boolean
}
