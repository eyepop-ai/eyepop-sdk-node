import {Endpoint} from "./endpoint";
import {Auth0Options, OAuth2Auth, Options, SecretKeyAuth, SessionAuth} from "./options";
import {EyePopPlot} from "./visualize";
import {CanvasRenderingContext2D} from "canvas";
import {authenticateBrowserSession} from "./shims/browser_session";

export {
    Session,
    IngressEvent,
    LiveIngress,
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

export class EyePopSdk {
    private static readonly envSecretKey = readEnv('EYEPOP_SECRET_KEY')

    static defaultAuth:SecretKeyAuth | undefined = EyePopSdk.envSecretKey ? {
        secretKey: EyePopSdk.envSecretKey,
    } : undefined

    public static endpoint({
                               auth = this.defaultAuth,
                               popId = readEnv('EYEPOP_POP_ID'),
                               eyepopUrl = readEnv('EYEPOP_URL'),
                               autoStart = true,
                               stopJobs = true,
                               jobQueueLength = 1024,
                               logger,
                               ...opts
                           }: Options = {}): Endpoint {
        if (((auth as OAuth2Auth).oAuth2 !== undefined) && popId) {
            if (typeof (auth as OAuth2Auth).oAuth2 === "boolean") {
                auth = {
                    oAuth2: {
                        domain: "eyepop.us.auth0.com",
                        clientId: "Lb9ubA9Hf3jlaqWLUx8XgA0zvotgViCl",
                        audience: "https://api.eyepop.ai",
                        scope: "admin:clouds"
                    }
                }
            }
        }
        if ((auth as SessionAuth).session !== undefined) {
            if ((auth as SessionAuth).session.popId) {
                popId = (auth as SessionAuth).session.popId
            }
            if ((auth as SessionAuth).session.eyepopUrl) {
                eyepopUrl = (auth as SessionAuth).session.eyepopUrl
            }
        }
        const options: Options = {
            auth: auth,
            popId: popId,
            eyepopUrl: eyepopUrl ?? 'https://api.eyepop.ai',
            autoStart: autoStart,
            stopJobs: stopJobs,
            jobQueueLength: jobQueueLength,
            logger: logger,
        };
        const endpoint = new Endpoint(options);
        return endpoint;
    }

    public static plot(context: CanvasRenderingContext2D): EyePopPlot {
        return new EyePopPlot(context)
    }
}

export default EyePopSdk