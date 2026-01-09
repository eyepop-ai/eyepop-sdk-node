/**
 * Type declarations for custom fetch options used by EyePop SDK.
 * Extends the standard RequestInit interface with platform-specific and SDK-specific options.
 */

export interface EyepopFetchOptions {
    /**
     * Enable response streaming for EyePop API endpoints.
     * Used to handle streaming responses from the inference API.
     */
    responseStreaming?: boolean
}

export interface ReactNativeFetchOptions {
    /**
     * Enable text streaming for React Native fetch.
     * Required for streaming responses in React Native environment.
     */
    textStreaming?: boolean
}

declare global {
    interface RequestInit {
        /**
         * Duplex mode for streaming requests.
         * Required for streaming request bodies with the Fetch API.
         * @see https://fetch.spec.whatwg.org/#request-duplex
         */
        duplex?: 'half' | 'full'

        /**
         * EyePop SDK-specific fetch options.
         */
        eyepop?: EyepopFetchOptions

        /**
         * React Native-specific fetch options.
         */
        reactNative?: ReactNativeFetchOptions

        /**
         * Undici Agent for Node.js fetch implementation.
         * Used to configure HTTP agent for connection pooling and timeouts.
         */
        dispatcher?: any
    }
}
