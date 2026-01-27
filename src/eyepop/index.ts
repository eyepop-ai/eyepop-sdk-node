import {ApiKeyAuth, LocalAuth, OAuth2Auth, Options, SessionAuth} from './options'

import { WorkerEndpoint } from './worker/worker_endpoint'
import { DataEndpoint } from './data/data_endpoint'

import { TransientPopId, WorkerOptions } from './worker/worker_options'
import { DataOptions } from './data/data_options'
import { WorkerSession } from './worker/worker_types'
import { DataSession } from './data/data_types'

export { WorkerEndpoint } from './worker/worker_endpoint'
export { DataEndpoint } from './data/data_endpoint'

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
} from './types'

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
    DatasetHeroAssetUpdate,
    DatasetVersion,
    UserReview,
    TranscodeMode,
    AutoAnnotateParams,
    ModelTrainingStage,
    ModelTrainingProgress,
    ModelMetrics,
    ModelSample,
    AssetImport,
    ModelExport,
    ModelExportStatus,
    ModelPrecisionType,
    ModelFormat,
    QcAiHubExportParams,
    ExportedBy,
    ArtifactType,
    DatasetParent,
    CreateWorkflowConfig,
    CreateWorkflow,
    Workflow,
    DownloadResponse,
    AssetUrlType,
    AutoAnnotateStatus,
    DatasetAutoAnnotate,
    DatasetAutoAnnotateCreate,
    DatasetAutoAnnotateUpdate,
    InferRuntimeConfig,
    TransformInto,
    InferRequest,
    EvaluateFilter,
    EvaluateRequest,
    EvaluationStatus,
    EvaluateRunInfo,
    EvaluateResponse,
    InferRunInfo,
    VlmAbilityStatus,
    AbilityAliasEntry,
    VlmAbilityCreate,
    VlmAbilityUpdate,
    VlmAbility,
    VlmAbilityGroupCreate,
    VlmAbilityGroupUpdate,
    VlmAbilityGroup,
} from './data/data_types'

export {
    WorkerSession,
    FileSource,
    MediaStreamSource,
    Source,
    PathSource,
    UrlSource,
    AssetUuidSource,
    StreamSource,
    ResultStream,
    VideoMode,
    ComponentParams,
    PredictionVersion,
    DEFAULT_PREDICTION_VERSION
} from './worker/worker_types'

export { Options, Authentication, SessionAuth, ApiKeyAuth, OAuth2Auth, Auth0Options, HttpClient, PlatformSupport, LocalAuth } from './options'

export { DataOptions } from './data/data_options'

export { WorkerOptions, TransientPopId } from './worker/worker_options'

export { EyepopLineDecoder } from './streaming'

const readEnv = (env: string): string | undefined => {
    if (typeof process !== 'undefined') {
        return process.env?.[env] ?? undefined
    }
    return undefined
}

const stringToBooleanSafe = (str?: string): boolean => {
    if (typeof str == 'undefined') {
        return false
    }
    const loweCaseStr = str.toLowerCase()
    return loweCaseStr == 'true' || loweCaseStr == 'yes'
}

export namespace EyePop {
    const envApiKey = readEnv('EYEPOP_API_KEY')

    const defaultAuth: ApiKeyAuth | undefined =
        envApiKey ? {
            apiKey: envApiKey
        } : undefined

    /**
     * @deprecated use workerEndpoint() instead
     */
    export const endpoint = workerEndpoint

    export function workerEndpoint(opts: WorkerOptions = {}): WorkerEndpoint {
        if (opts.isLocalMode === undefined) {
            opts.isLocalMode = stringToBooleanSafe(readEnv('EYEPOP_LOCAL_MODE'))
        }
        if (opts.isLocalMode) {
            opts.eyepopUrl = 'http://127.0.0.1:8080'
        }
        _fill_default_options(opts)
        if (opts.auth === undefined) {
            if (opts.isLocalMode) {
                opts.auth = { isLocal: true } as LocalAuth
            } else {
                throw new Error('auth option or EYEPOP_API_KEY environment variable is required')
            }
        }
        if (opts.popId === undefined) {
            opts.popId = readEnv('EYEPOP_POP_ID') || TransientPopId.Transient
        }

        if (opts.autoStart === undefined) {
            opts.autoStart = true
        }

        if (opts.stopJobs === undefined) {
            opts.stopJobs = true
        }

        if (opts.auth !== undefined) {
            if ((opts.auth as SessionAuth).session !== undefined) {
                if (((opts.auth as SessionAuth).session as WorkerSession) !== undefined) {
                    if (((opts.auth as SessionAuth).session as WorkerSession).popId) {
                        opts.popId = ((opts.auth as SessionAuth).session as WorkerSession).popId
                    }
                }
            }
        }
        return new WorkerEndpoint(opts)
    }

    export function dataEndpoint(opts: DataOptions = {}): DataEndpoint {
        _fill_default_options(opts)
        if (opts.auth === undefined) {
            throw new Error('auth option or EYEPOP_API_KEY environment variable is required')
        }
        if (opts.accountId === undefined) {
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
        if (!opts.auth) {
            opts.auth = defaultAuth
        }

        if (!opts.eyepopUrl && opts.auth && (opts.auth as SessionAuth).session && (opts.auth as SessionAuth).session.eyepopUrl) {
            // Pre-authenticated browser session may overwrite eyepopUrl
            opts.eyepopUrl = (opts.auth as SessionAuth).session.eyepopUrl
        }

        if (!opts.eyepopUrl) {
            opts.eyepopUrl = readEnv('EYEPOP_URL')
        }

        if (!opts.eyepopUrl) {
            opts.eyepopUrl = 'https://compute.eyepop.ai'
        }

        if (opts.auth) {
            if ((opts.auth as OAuth2Auth).oAuth2 !== undefined) {
                if (typeof (opts.auth as OAuth2Auth).oAuth2 === 'boolean') {
                    if (opts.eyepopUrl && opts.eyepopUrl.match(/https:(.*).staging.eyepop.xyz/i)) {
                        opts.auth = {
                            oAuth2: {
                                domain: 'dev-eyepop.us.auth0.com',
                                clientId: 'jktx3YO2UnbkNPvr05PQWf26t1kNTJyg',
                                audience: 'https://dev-app.eyepop.ai',
                                scope: 'admin:clouds access:inference-api access:datasets',
                            },
                        }
                    } else {
                        opts.auth = {
                            oAuth2: {
                                domain: 'eyepop.us.auth0.com',
                                clientId: 'Lb9ubA9Hf3jlaqWLUx8XgA0zvotgViCl',
                                audience: 'https://api.eyepop.ai',
                                scope: 'admin:clouds access:inference-api access:datasets',
                            },
                        }
                    }
                }
            }
        }
        if (!opts.jobQueueLength) {
            opts.jobQueueLength = 128
        }
    }
}

export * from './types'
export * from './endpoint'
export * from './options'
export * from './semaphore'
export * from './streaming'
export * from './data/data_types'
export * from './data/data_options'
export * from './data/data_endpoint'
export * from './worker/worker_types'
export * from './worker/worker_options'
export * from './worker/worker_endpoint'
export * from './worker/jobs'
export * from './worker/webrtc_base'
export * from './worker/webrtc_whep'
export * from './worker/webrtc_whip'
export default EyePop
