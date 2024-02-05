import {Session} from "../types";

export let authenticateBrowserSession: (oauthUrl: string, eyepopUrl: string, popId: string) => Session | null

if ('document' in globalThis && 'implementation' in globalThis.document) {
    authenticateBrowserSession = (oauthUrl: string, eyepopUrl: string, popId: string) => {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        let token = urlParams.get('pop_token');

        if (token) {
            urlParams.delete('pop_token')
            const url = `${window.location.pathname}?${urlParams}`
            window.history.replaceState({}, document.title, url)
            return {
                eyepopUrl: eyepopUrl, popId: popId, accessToken: token, validUntil: Date.now() + (60 * 60 * 1000)
            }
        } else {
            const url = `${oauthUrl}?url=${encodeURIComponent(window.location.href)}`;
            window.location.replace(url);
            return {
                eyepopUrl: eyepopUrl, popId: popId, accessToken: "in-progress", validUntil: 0
            }
        }
    }
} else {
    authenticateBrowserSession = (oauthUrl: string, eyepopUrl: string, popId: string) => {
        return null
    }
}
