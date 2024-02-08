import {Endpoint} from "./endpoint";
import {Options} from "./options";
import {EyePopPlot} from "./visualize";
import {CanvasRenderingContext2D} from "canvas";
import {authenticateBrowserSession} from "./shims/browser_session";

export {
    Session,
    EndpointState,
    UploadParams,
    Prediction,
    PredictedClass,
    PredictedObject,
    PredictedMesh,
    PredictedKeyPoint,
    PredictedKeyPoints,
    Point2d,
    Point3d
} from "./types";

const readEnv = (env: string): string | undefined => {
    if (typeof process !== 'undefined') {
        return process.env?.[env] ?? undefined;
    }
    return undefined;
};

export class EyePopSdk {
    static defaultAuth = {
        secretKey: readEnv('EYEPOP_SECRET_KEY'),
    }

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
        if (auth.oAuth && popId) {
            let oauthUrl = "https://dashboard.eyepop.ai/sdkauth"
            if (typeof auth.oAuth == "string") {
                oauthUrl = auth.oAuth
            }
            auth.session = authenticateBrowserSession(oauthUrl, eyepopUrl ?? 'https://api.eyepop.ai', popId) ?? undefined
        }
        const options: Options = {
            auth: auth,
            popId: auth.session ? auth.session.popId : popId,
            eyepopUrl: auth.session ? auth.session.eyepopUrl : (eyepopUrl ?? 'https://api.eyepop.ai'),
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