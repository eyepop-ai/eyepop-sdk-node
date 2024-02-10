import {Session} from "../types"
import {Auth0Options} from "../options"
import {createAuth0Client} from "@auth0/auth0-spa-js"
import {Auth0ClientOptions} from "@auth0/auth0-spa-js/src/global";

export let authenticateBrowserSession: (auth0: Auth0Options, eyepopUrl: string, popId: string) => Promise<Session>

if ('document' in globalThis && 'implementation' in globalThis.document) {
    authenticateBrowserSession = async (auth0: Auth0Options, eyepopUrl: string, popId: string) => {
        const options: Auth0ClientOptions = {
            clientId: auth0.clientId,
            domain: auth0.domain,
            authorizationParams: {
                scope:auth0.scope,
                audience:auth0.audience
            }
        }
        const auth0Client = await createAuth0Client(options)
        if (!await auth0Client.isAuthenticated()) {
            await auth0Client.loginWithPopup()
        }
        const accessToken = await auth0Client.getTokenSilently()
        console.log(await auth0Client.getIdTokenClaims())
        if (!accessToken) {
            return Promise.reject('auth0 login failed')
        }
        const session: Session = {
            eyepopUrl: eyepopUrl, popId: popId, accessToken: accessToken, validUntil: Date.now() + (60 * 60 * 1000)
        }
        return session
    }
} else {
    authenticateBrowserSession = (auth0: Auth0Options, eyepopUrl: string, popId: string) => {
        return Promise.reject('auth0 login not supported server-side')
    }
}
