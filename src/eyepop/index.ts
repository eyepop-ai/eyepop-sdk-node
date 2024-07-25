import {OAuth2Auth, SecretKeyAuth, SessionAuth, Options} from "./options"

import {WorkerEndpoint} from "./worker/worker_endpoint"
import {DataEndpoint} from "./data/data_endpoint"

import {WorkerOptions} from "./worker/worker_options"
import {DataOptions} from "./data/data_options"
import {WorkerSession} from "./worker/worker_types"
import {DataSession} from "./data/data_types"

export {WorkerEndpoint} from "./worker/worker_endpoint"
export {DataEndpoint} from "./data/data_endpoint"


export {
    Session,
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
    Point3d
} from "./types";

export {
    ChangeType,
    DataSession,
    ModelType,
    ChangeEvent,
    Asset,
    AnnotationType,
    Annotation,
    AssetStatus,
    OnChangeEvent,
    Model,
    ModelStatus,
    ModelUpdate,
    ModelCreate,
    DatasetCreate,
    Dataset,
    DatasetUpdate,
    DatasetVersion,
    UserReview,
    TranscodeMode
} from "./data/data_types";

export {
    WorkerSession,
    FileSource,
    LiveSource,
    LiveMedia,
    Source,
    ModelPrecisionType,
    ModelFormat,
    PathSource,
    UrlSource,
    ModelInstanceDef,
    SourcesEntry,
    StreamSource,
    ResultStream,
    IngressEvent
} from "./worker/worker_types";

export {
    Options, Authentication, SessionAuth, SecretKeyAuth, OAuth2Auth, Auth0Options
} from "./options";

export {
    DataOptions
} from "./data/data_options";


export {
    WorkerOptions, TransientPopId
} from "./worker/worker_options";


const readEnv = (env: string): string | undefined => {
    if (typeof process !== 'undefined') {
        return process.env?.[env] ?? undefined;
    }
    return undefined;
};

export namespace EyePop {
    const envSecretKey = readEnv('EYEPOP_SECRET_KEY')

    const defaultAuth: SecretKeyAuth | undefined = envSecretKey ? {
        secretKey: envSecretKey,
    } : undefined


    /**
     * @deprecated use workerEndpoint() instead
     */
    export const endpoint = workerEndpoint

    export function workerEndpoint(opts: WorkerOptions = {}): WorkerEndpoint {
        _fill_default_options(opts)
        if (typeof opts.popId == "undefined") {
            opts.popId = readEnv('EYEPOP_POP_ID')
        }

        if (typeof opts.autoStart == "undefined") {
            opts.autoStart = true
        }

        if (typeof opts.stopJobs == "undefined") {
            opts.stopJobs = true
        }

        if ((opts.auth as SessionAuth).session !== undefined) {
            if (((opts.auth as SessionAuth).session as WorkerSession) !== undefined) {
                if (((opts.auth as SessionAuth).session as WorkerSession).popId) {
                    opts.popId = ((opts.auth as SessionAuth).session as WorkerSession).popId
                }
            }
        }
        return new WorkerEndpoint(opts)
    }

    export function dataEndpoint(opts: DataOptions = {}): DataEndpoint {
        _fill_default_options(opts)
        if (typeof opts.accountId == "undefined") {
            opts.accountId = readEnv('EYEPOP_ACCOUNT_ID')
        }

        if ((opts.auth as SessionAuth).session !== undefined) {
            if (((opts.auth as SessionAuth).session as DataSession) !== undefined) {
                if (((opts.auth as SessionAuth).session as DataSession).accountId) {
                    opts.accountId = ((opts.auth as SessionAuth).session as DataSession).accountId
                }
            }
        }
        return new DataEndpoint(opts)
    }

    function _fill_default_options(opts: Options) {
        if (typeof opts.auth == "undefined") {
            if (typeof defaultAuth == "undefined") {
                throw new Error('auth option or EYEPOP_SECRET_KEY environment variable is required')
            }
            opts.auth = defaultAuth
        }

        if (typeof opts.eyepopUrl == "undefined") {
            opts.eyepopUrl = readEnv('EYEPOP_URL') || 'https://api.eyepop.ai'
        }

        if (typeof opts.jobQueueLength == "undefined") {
            opts.jobQueueLength = 1024
        }

        if ((typeof (opts.auth as OAuth2Auth).oAuth2 != "undefined")) {
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
            if ((opts.auth as SessionAuth).session.eyepopUrl) {
                opts.eyepopUrl = (opts.auth as SessionAuth).session.eyepopUrl
            }
        }
    }
}

export default EyePop
