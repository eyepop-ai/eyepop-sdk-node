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
    /**
     * The account the compute session runs and is billed under, sent to compute-api as
     * `account_uuid`. Required when the credential does not name one account.
     * Defaults to process.env['EYEPOP_ACCOUNT_UUID'], then the deprecated process.env['EYEPOP_ACCOUNT_ID'].
     */
    accountId?: string | undefined
    pipelineImage?: string | undefined
    pipelineVersion?: string | undefined
    pop?: Pop | undefined
    sessionReadyTimeoutSeconds?: number | undefined
    autoStart?: boolean
    stopJobs?: boolean
    isLocalMode?: boolean
    /**
     * Run the endpoint's jobs on the pipeline API's socket instead of a worker session. The
     * compute API at `eyepopUrl` names the pipeline API in its `/v1/configs`; with `isLocalMode`,
     * `eyepopUrl` is the pipeline API itself. Takes no option that names a session or a pop id.
     * Defaults to process.env['EYEPOP_IS_PIPELINE_MODE'].
     */
    isPipelineMode?: boolean
}
