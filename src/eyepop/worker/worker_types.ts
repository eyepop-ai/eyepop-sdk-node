import { Prediction, Session } from '../types'

export enum PredictionVersion {
    V1 = 1,
    V2 = 2
}

export const DEFAULT_PREDICTION_VERSION: PredictionVersion = PredictionVersion.V2

export interface WorkerSession extends Session {
    readonly popId: string
    readonly baseUrl: string | undefined
    readonly pipelineId: string | undefined
    authenticationHeaders() : any
}

export enum VideoMode {
    STREAM = 'stream',
    BUFFER = 'buffer'
}

export interface FileSource {
    readonly file: File
    readonly videoMode?: VideoMode  | undefined
}

export interface StreamSource {
    readonly stream: ReadableStream<Uint8Array> | Blob | BufferSource
    readonly mimeType: string
    readonly size?: number | undefined
    readonly videoMode?: VideoMode  | undefined
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
    targetFps?: string
    params?: {[index: string]: any}
}
export interface TrackingComponent extends BaseComponent {
    reidModelUuid?: string
    reidModel?: string
    maxAgeSeconds?: number
    iouThreshold?: number
    simThreshold?: number
    agnostic?: boolean
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

export interface Pop {
    components: PopComponent[]
    postTransform?: string
}

export interface ComponentParams {
    componentId: number
    values: {[index: string]: any}
}