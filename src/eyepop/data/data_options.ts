import { Options } from 'EyePop/options'

export interface DataOptions extends Options {
    /**
     * Defaults to process.env['EYEPOP_ACCOUNT_ID'].
     */
    accountId?: string | undefined
    disableWs?: boolean | undefined
    useCookie?: boolean | undefined
}
