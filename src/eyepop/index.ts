import { LocalAuth, OAuth2Auth, Options, SecretKeyAuth, SessionAuth } from './options'

import { WorkerEndpoint } from './worker/worker_endpoint'
import { DataEndpoint } from './data/data_endpoint'

import { TransientPopId, WorkerOptions } from './worker/worker_options'
import { DataOptions } from './data/data_options'
import { WorkerSession } from './worker/worker_types'
import { DataSession } from './data/data_types'

export { WorkerEndpoint } from './worker/worker_endpoint'
export { DataEndpoint } from './data/data_endpoint'

export { Session, EndpointState, StreamTime, Prediction, PredictedClass, PredictedObject, PredictedMesh, PredictedKeyPoint, PredictedKeyPoints, Contour, Point2d, Point3d } from './types'

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
    QcAiHubExportParams,
    ExportedBy,
    ArtifactType,
} from './data/data_types'

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
    IngressEvent,
} from './worker/worker_types'

export { Options, Authentication, SessionAuth, SecretKeyAuth, OAuth2Auth, Auth0Options } from './options'

export { DataOptions } from './data/data_options'

export { WorkerOptions, TransientPopId } from './worker/worker_options'

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
    const envSecretKey = readEnv('EYEPOP_SECRET_KEY')

    const defaultAuth: SecretKeyAuth | undefined = envSecretKey
        ? {
              secretKey: envSecretKey,
          }
        : undefined

    /**
     * @deprecated use workerEndpoint() instead
     */
    export const endpoint = workerEndpoint

    export function workerEndpoint(opts: WorkerOptions = {}): WorkerEndpoint {
        if (opts.isLocalMode === undefined) {
            opts.isLocalMode = stringToBooleanSafe(readEnv('EYEPOP_LOCAL_MODE'))
        }
        _fill_default_options(opts, opts.isLocalMode ? 'http://127.0.0.1:8080/standalone' : undefined)
        if (opts.auth === undefined) {
            if (opts.isLocalMode) {
                opts.auth = { isLocal: true } as LocalAuth
            } else {
                throw new Error('auth option or EYEPOP_SECRET_KEY environment variable is required')
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
            throw new Error('auth option or EYEPOP_SECRET_KEY environment variable is required')
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

    function _fill_default_options(opts: Options, default_eyepop_url: string = 'https://api.eyepop.ai') {
        if (opts.auth === undefined) {
            opts.auth = defaultAuth
        }

        if (opts.eyepopUrl === undefined) {
            opts.eyepopUrl = readEnv('EYEPOP_URL') || default_eyepop_url
        }

        if (opts.jobQueueLength === undefined) {
            opts.jobQueueLength = 1024
        }

        if (opts.auth !== undefined) {
            if ((opts.auth as OAuth2Auth).oAuth2 !== undefined) {
                if (typeof (opts.auth as OAuth2Auth).oAuth2 === 'boolean') {
                    if (opts.eyepopUrl.startsWith('https://web-api.staging.eyepop.xyz')) {
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
            if ((opts.auth as SessionAuth).session !== undefined) {
                if ((opts.auth as SessionAuth).session.eyepopUrl) {
                    opts.eyepopUrl = (opts.auth as SessionAuth).session.eyepopUrl
                }
            }
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
