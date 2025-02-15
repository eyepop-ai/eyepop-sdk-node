import { Options } from 'EyePop/options'

export enum TransientPopId {
    Transient = 'transient',
}

export interface WorkerOptions extends Options {
    /**
     * Defaults to process.env['EYEPOP_POP_ID'].
     */
    popId?: string | TransientPopId | undefined
    isSandbox?: boolean
    autoStart?: boolean
    stopJobs?: boolean
    isLocalMode?: boolean
}
