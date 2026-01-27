import { Options } from '../options'

export enum TransientPopId {
    Transient = 'transient',
}

export interface WorkerOptions extends Options {
    /**
     * TODO: deprecated, defaults to process.env['EYEPOP_POP_ID'].
     */
    popId?: string | TransientPopId | undefined
    autoStart?: boolean
    stopJobs?: boolean
    isLocalMode?: boolean
}
