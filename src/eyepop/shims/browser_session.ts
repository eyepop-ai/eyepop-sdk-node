import { Session } from '../types'
import { Auth0Options, LocalAuth, OAuth2Auth, Options } from '../options'
import { createAuth0Client } from '@auth0/auth0-spa-js'
import { Auth0ClientOptions } from '@auth0/auth0-spa-js/src/global'
import { WorkerOptions, WorkerSession } from '../index'

export let authenticateBrowserSession: (auth0: Auth0Options, options: Options) => Promise<Session>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    authenticateBrowserSession = async (auth0: Auth0Options, options: Options) => {
        if (options.eyepopUrl == null) {
            return Promise.reject('options.eyepopUrl cannot be null')
        }
        const auth0ClientOptions: Auth0ClientOptions = {
            clientId: auth0.clientId,
            domain: auth0.domain,
            authorizationParams: {
                scope: auth0.scope,
                audience: auth0.audience,
            },
        }
        const auth0Client = await createAuth0Client(auth0ClientOptions)
        if (!(await auth0Client.isAuthenticated())) {
            await auth0Client.loginWithPopup()
        }
        const accessToken = await auth0Client.getTokenSilently()
        if (!accessToken) {
            return Promise.reject('auth0 login failed')
        }
        let session: Session
        const workerOptions = options as WorkerOptions
        if (typeof workerOptions.popId != 'undefined') {
            const workerSession: WorkerSession = {
                eyepopUrl: options.eyepopUrl,
                accessToken: accessToken,
                validUntil: Date.now() + 60 * 60 * 1000,
                popId: workerOptions.popId,
                baseUrl: undefined,
                pipelineId: undefined,
                authenticationHeaders: () => {
                    return { Authorization: `Bearer ${accessToken}` }
                }
            }
            session = workerSession
        } else {
            session = {
                eyepopUrl: options.eyepopUrl,
                accessToken: accessToken,
                validUntil: Date.now() + 60 * 60 * 1000,
            }
        }
        return session
    }
} else {
    authenticateBrowserSession = (auth0: Auth0Options, options: Options) => {
        return Promise.reject('auth0 login not supported server-side')
    }
}
