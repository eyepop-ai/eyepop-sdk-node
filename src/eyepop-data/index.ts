import {Endpoint} from "./endpoint"
import {OAuth2Auth, Options, SecretKeyAuth, SessionAuth} from "./options"

export {
    Session,
    IngressEvent,
    LiveMedia,
    ResultStream,
    EndpointState,
    StreamTime,
    Prediction,
    PredictedClass,
    PredictedObject,
    PredictedMesh,
    PredictedKeyPoint,
    PredictedKeyPoints,
    Contour,
    Point2d,
    Point3d,
    Source,
    StreamSource,
    LiveSource,
    UrlSource,
    PathSource,
    FileSource
} from "../eyepop/types";

const readEnv = (env: string): string | undefined => {
    // if (typeof process !== 'undefined') {
    //     return process.env?.[env] ?? undefined;
    // }
    return undefined;
};

export namespace EyePopData {
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

        if (typeof opts.eyepopUrl == "undefined") {
            opts.eyepopUrl = 'https://staging-api.eyepop.ai'
        }

        if ((typeof (opts.auth as OAuth2Auth).oAuth2 != "undefined")) {
            if (typeof (opts.auth as OAuth2Auth).oAuth2 === "boolean") {
                if (opts.eyepopUrl.startsWith('https://staging-api.eyepop.ai')) {
                    opts.auth = {
                        oAuth2: {
                            domain: "dev-eyepop.us.auth0.com",
                            clientId: "jktx3YO2UnbkNPvr05PQWf26t1kNTJyg",
                            audience: "https://dev-app.eyepop.ai",
                            scope: "access:datasets"
                        }
                    }
                    console.log('Using dev-eyepop.us.auth0.com')
                } else {
                    opts.auth = {
                        oAuth2: {
                            domain: "eyepop.us.auth0.com",
                            clientId: "Lb9ubA9Hf3jlaqWLUx8XgA0zvotgViCl",
                            audience: "https://api.eyepop.ai",
                            scope: "access:datasets"
                        }
                    }
                }
            }
        }

        const endpoint = new Endpoint(opts);
        return endpoint;
    }
}

export default EyePopData