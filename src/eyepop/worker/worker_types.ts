import { Prediction, Session } from '../types'
import { Area } from 'EyePop/data/data_types'
import { Camera, validateCamera } from '../camera'

export enum PredictionVersion {
    V1 = 1,
    V2 = 2,
}

export const DEFAULT_PREDICTION_VERSION: PredictionVersion = PredictionVersion.V2

export interface WorkerSession extends Session {
    /**
     * @deprecated Pop ids are only retained for backwards compatibility.
     * Configure transient sessions with `WorkerOptions.pop`.
     */
    readonly popId: string
    readonly baseUrl: string | undefined
    /**
     * Transient sessions may not have a pipeline until the first source is processed.
     */
    readonly pipelineId: string | undefined
    authenticationHeaders(): any
}

export enum VideoMode {
    STREAM = 'stream',
    BUFFER = 'buffer',
}

export interface FileSource {
    readonly file: File
    readonly videoMode?: VideoMode | undefined
}

export interface StreamSource {
    readonly stream: ReadableStream<Uint8Array> | Blob | BufferSource
    readonly mimeType: string
    readonly size?: number | undefined
    readonly videoMode?: VideoMode | undefined
}

export interface PathSource {
    readonly path: string
    readonly mimeType?: string | undefined
    readonly videoMode?: VideoMode | undefined
}

export interface MediaStreamSource {
    readonly mediaStream: MediaStream
}

export interface UrlSource {
    readonly url: string
}

export interface AssetUuidSource {
    readonly assetUuid: string
}

export type Source = FileSource | StreamSource | PathSource | UrlSource | AssetUuidSource | MediaStreamSource

export interface ResultStream extends AsyncIterable<Prediction> {
    cancel(): void
}

// Pop definition types

export enum PopComponentType {
    FORWARD = 'forward',
    INFERENCE = 'inference',
    // backward compatibility, for serialized pops < 3.0.0
    TRACING = 'tracing',
    // since 3.0.0
    TRACKING = 'tracking',
    CONTOUR_FINDER = 'contour_finder',
    COMPONENT_FINDER = 'component_finder',
}

export enum ForwardOperatorType {
    FULL = 'full',
    CROP = 'crop',
    CROP_WITH_FULL_FALLBACK = 'crop_with_full_fallback',
}

export interface PopCrop {
    maxItems?: number
    boxPadding?: number
    orientationTargetAngle?: number
}

export interface PopForwardOperator {
    type: ForwardOperatorType
    includeClasses?: string[]
    crop?: PopCrop
}

export interface PopForward {
    operator?: PopForwardOperator
    targets: PopComponent[]
}
export interface BaseComponent {
    type: PopComponentType
    id?: number
    forward?: PopForward
    /**
     * Enrich this component's point based predictions with world coordinates,
     * back-projected through the Pop's `depthMap`.
     *
     * Declared here because the instance declares it on one shared component
     * type, but only a component that runs its own inference can honour it -
     * inference and tracking - since that is what gives it an id for the worker
     * to select on. Asking for it on a forward, contour finder or component
     * finder is rejected when the Pop is compiled. A contour finder's points do
     * get enriched, but they belong to the object that fed it, so the request
     * goes on the inference component upstream.
     *
     * Enrichment needs a *metric* depth ability. A `relative` map is accepted
     * and silently produces no world coordinates: its shift is unknown, so a
     * cloud recovered from it would be distorted rather than merely unscaled.
     */
    toWorld?: boolean
}

export interface ForwardComponent extends BaseComponent {}

export enum InferenceType {
    IMAGE_CLASSIFICATION = 'image_classification',
    OBJECT_DETECTION = 'object_detection',
    KEY_POINTS = 'key_points',
    OCR = 'ocr',
    MESH = 'mesh',
    FEATURE_VECTOR = 'feature_vector',
    SEMANTIC_SEGMENTATION = 'semantic_segmentation',
    SEGMENTATION = 'segmentation',
}

export interface InferenceComponent extends BaseComponent {
    inferenceTypes?: InferenceType[]
    hidden?: boolean
    modelUuid?: string
    model?: string
    abilityUuid?: string
    ability?: string
    categoryName?: string
    confidenceThreshold?: number
    topK?: number
    topKClasses?: number
    targetFps?: string
    videoChunkLengthSeconds?: number
    videoChunkOverlap?: number
    params?: { [index: string]: any }
}

export enum MotionModel {
    RANDOM_WALK = 'random_walk',
    CONSTANT_VELOCITY = 'constant_velocity',
    CONSTANT_ACCELERATION = 'constant_acceleration',
}

export interface TrackingComponent extends BaseComponent {
    reidModelUuid?: string
    reidModel?: string
    maxAgeSeconds?: number
    iouThreshold?: number
    simThreshold?: number
    agnostic?: boolean
    processNoisePosition?: number
    processNoiseVelocity?: number
    processNoiseAcceleration?: number
    processNoiseScale?: number
    processNoiseAspectRatio?: number
    measurementNoiseCx?: number
    measurementNoiseCy?: number
    measurementNoiseArea?: number
    measurementNoiseAspectRatio?: number
    motionModel?: MotionModel
    downweightLowConfidenceDetections?: boolean
    classBeta?: number
    classGamma?: number
    classHysteresis?: boolean
    classHysteresisHighThreshold?: number
    classHysteresisLowThreshold?: number
    classHysteresisMinHoldFrames?: number
    classHysteresisAllowedClasses?: string[]
}

export enum ContourType {
    ALL_PIXELS = 'all_pixels',
    POLYGON = 'polygon',
    CONVEX_HULL = 'convex_hull',
    HOUGH_CIRCLES = 'hough_circles',
    CIRCLE = 'circle',
    TRIANGLE = 'triangle',
    RECTANGLE = 'rectangle',
}

export interface ContourFinderComponent extends BaseComponent {
    contourType: ContourType
    areaThreshold?: number
}

export interface ComponentFinderComponent extends BaseComponent {
    dilate?: number
    erode?: number
    keepSource?: boolean
    componentClassLabel?: string
}

export type PopComponent = ForwardComponent | InferenceComponent | TrackingComponent | ContourFinderComponent | ComponentFinderComponent

/**
 * The depth ability whose frame level map feeds world coordinates.
 *
 * `ability` names it by alias and `abilityUuid` by uuid; give exactly one. A
 * Pop has one depth map because the worker back-projects every prediction
 * through it, so a second depth source would have nowhere to go. Naming one
 * makes the converter build the depth branch itself and keep it out of the
 * response - the caller asked for coordinates, not for a megabyte of base64
 * depth per frame.
 *
 * `toWorld` back-projects the map itself, so the response carries a point cloud
 * of the whole scene rather than one per segmented object. It is also what
 * reveals the map: without it the injected branch stays out of the response
 * entirely. Read the result with cloudOfDepth().
 *
 * Use a *metric* depth ability. A `relative` one is accepted and yields no
 * world coordinates at all.
 */
export interface PopDepthMap {
    ability?: string
    abilityUuid?: string
    toWorld?: boolean
}

/**
 * Source level parameters a Pop applies to every source it processes, each
 * overridable per source.
 *
 * Merged per field against whatever a source supplies, so a source giving its
 * own roi but no camera keeps its roi and takes the default camera. Because the
 * camera merges as one field, a source declaring its own lens replaces a
 * defaulted one outright rather than mixing the two.
 */
export interface SourceDefaults {
    camera?: Camera
    roi?: Area
    fps?: string
    motionDetect?: boolean
    motionSensitivity?: number
    motionThreshold?: number
    motionGap?: number
    motionGridX?: number
    motionGridY?: number
}

export interface Pop {
    components: PopComponent[]
    postTransform?: string
    defaults?: SourceDefaults
    depthMap?: PopDepthMap
}

/**
 * Throw if a Pop cannot mean what it says.
 *
 * Only the parts a caller can get wrong locally: the worker rejects both of
 * these too, but as a 400 once the Pop is already in flight.
 */
export function validatePop(pop: Pop): void {
    if (pop.depthMap !== undefined) {
        // naming no ability is a depth branch that cannot be built, and naming
        // two is a Pop with no right answer
        if ((pop.depthMap.ability === undefined) === (pop.depthMap.abilityUuid === undefined)) {
            throw new Error('depthMap requires exactly one of ability or abilityUuid')
        }
    }
    if (pop.defaults?.camera !== undefined) {
        validateCamera(pop.defaults.camera)
    }
}

export interface MotionDetectConfig {
    motionDetect: boolean
    motionSensitivity?: number
    motionThreshold?: number
    motionGap?: number
    motionGridX?: number
    motionGridY?: number
}

export interface ComponentParams {
    componentId: number
    values: { [index: string]: any }
}

export interface ProcessParams {
    componentParams?: ComponentParams[] | undefined
    motionDetect?: MotionDetectConfig | undefined
    roi?: Area | undefined
    fps?: string | undefined
    /**
     * This source's camera calibration, overriding the Pop's `defaults.camera`.
     *
     * Without one the worker assumes a 60 degree horizontal field of view,
     * which is a development scaffold: for canonical metric depth the guess
     * cancels out of X and Y and survives only in Z, so lateral measurements
     * stay exact while every distance along the optical axis is wrong by
     * however wrong the guess was.
     */
    camera?: Camera | undefined
}

export interface ProcessRequest extends ProcessParams {
    source: Source
}
