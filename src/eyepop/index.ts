import {Endpoint} from "./endpoint"
import {OAuth2Auth, Options, SecretKeyAuth, SessionAuth} from "./options"

export {
    Session,
    IngressEvent,
    LiveMedia,
    ResultStream,
    EndpointState,
    Prediction,
    PredictedClass,
    PredictedObject,
    PredictedMesh,
    PredictedKeyPoint,
    PredictedKeyPoints,
    Point2d,
    Point3d,
    Source,
    StreamSource,
    LiveSource,
    UrlSource,
    PathSource,
    FileSource
} from "./types";

const readEnv = (env: string): string | undefined => {
    if (typeof process !== 'undefined') {
        return process.env?.[env] ?? undefined;
    }
    return undefined;
};

export namespace EyePop {
    const envSecretKey = readEnv('EYEPOP_SECRET_KEY')

    const defaultAuth:SecretKeyAuth | undefined = envSecretKey ? {
        secretKey: envSecretKey,
    } : undefined

    export function endpoint(opts: Options = {}): Endpoint {
        if (typeof opts.auth == "undefined") {
            if (typeof defaultAuth == "undefined") {
                throw new Error('auth option or EYEPOP_SECRET_KEY environment variable is required')
            }
            opts.auth = defaultAuth
        }

        if (typeof opts.popId == "undefined") {
            opts.popId = readEnv('EYEPOP_POP_ID')
        }

        if (typeof opts.eyepopUrl == "undefined") {
            opts.eyepopUrl = readEnv('EYEPOP_URL') || 'https://api.eyepop.ai'
        }

        if (typeof opts.autoStart == "undefined") {
            opts.autoStart = true
        }

        if (typeof opts.stopJobs == "undefined") {
            opts.stopJobs = true
        }

        if (typeof opts.jobQueueLength == "undefined") {
            opts.jobQueueLength = 1024
        }

        if ((typeof (opts.auth as OAuth2Auth).oAuth2 != "undefined") && opts.popId) {
            if (typeof (opts.auth as OAuth2Auth).oAuth2 === "boolean") {
                if (opts.eyepopUrl.startsWith('https://staging-api.eyepop.ai')) {
                    opts.auth = {
                        oAuth2: {
                            domain: "dev-eyepop.us.auth0.com",
                            clientId: "jktx3YO2UnbkNPvr05PQWf26t1kNTJyg",
                            audience: "https://dev-app.eyepop.ai",
                            scope: "admin:clouds"
                        }
                    }
                } else {
                    opts.auth = {
                        oAuth2: {
                            domain: "eyepop.us.auth0.com",
                            clientId: "Lb9ubA9Hf3jlaqWLUx8XgA0zvotgViCl",
                            audience: "https://api.eyepop.ai",
                            scope: "admin:clouds"
                        }
                    }
                }
            }
        }
        if ((opts.auth as SessionAuth).session !== undefined) {
            if ((opts.auth as SessionAuth).session.popId) {
                opts.popId = (opts.auth as SessionAuth).session.popId
            }
            if ((opts.auth as SessionAuth).session.eyepopUrl) {
                opts.eyepopUrl = (opts.auth as SessionAuth).session.eyepopUrl
            }
        }
        const endpoint = new Endpoint(opts);
        return endpoint;
    }
}

export default EyePop