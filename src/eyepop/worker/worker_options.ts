import { Options } from '../options'

export enum TransientPopId {
    Transient = 'transient',
}

export interface WorkerOptions extends Options {
    /**
     * TODO: deprecated, support for pop id will be removed in 3.16
     */
    popId?: string | TransientPopId | undefined

    sessionUuid?: string | undefined
    autoStart?: boolean
    stopJobs?: boolean
    isLocalMode?: boolean
}
