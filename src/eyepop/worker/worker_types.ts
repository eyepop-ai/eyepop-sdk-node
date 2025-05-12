import { Prediction, Session } from '../types'

export interface WorkerSession extends Session {
    readonly popId: string
    readonly baseUrl: string | undefined
    readonly pipelineId: string | undefined
    readonly sandboxId: string | undefined
    authenticationHeaders() : any
}

export interface LiveMedia {
    ingressId(): string
    stream(): Promise<MediaStream>
    close(): Promise<void>
}

export enum VideoMode {
    STREAM = 'stream',
    BUFFER = 'buffer'
}

export interface IngressEvent {
    readonly ingressId: string
    readonly event: 'stream-ready' | 'stream-not-ready'
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

export interface LiveSource {
    readonly ingressId: string
}

export interface UrlSource {
    readonly url: string
}

export type Source = FileSource | StreamSource | PathSource | LiveSource | UrlSource

export interface ResultStream extends AsyncIterable<Prediction> {
    cancel(): void
}

// Deprecated: Model loading types

export type SourcesEntry = {
    readonly authority: string
    readonly manifest: string
}

export enum ModelFormat {
    TensorFlowLite = 'TensorFlowLite',
    TensorFlowGraphDef = 'TensorFlowGraphDef',
    ONNX = 'ONNX',
    TorchScript = 'TorchScript',
    TorchScriptCpu = 'TorchScriptCpu',
    TorchScriptCuda = 'TorchScriptCuda',
    PyTorch = 'PyTorch',
    ModelLess = 'ModelLess'
}

export enum ModelPrecisionType {
    float32 = 'float32',
    float16 = 'float16',
    int32 = 'int32',
    int8 = 'int8',
    uint8 = 'uint8',
}

export interface ModelInstanceDef {
    id?: string
    model_folder_url?: string
    model_id?: string
    dataset?: string
    version?: string
    format?: ModelFormat
    type?: ModelPrecisionType
}

// Pop definition types

export enum PopComponentType {
    FORWARD = 'forward',
    INFERENCE = 'inference',
    TRACING = 'tracing',
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
    targetFps?: string
}
export interface TracingComponent extends BaseComponent {
    reidModelUuid?: string
    reidModel?: string
    maxAgeSeconds?: number
    iouThreshold?: number
    simThreshold?: number
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

export type PopComponent = ForwardComponent | InferenceComponent | TracingComponent | ContourFinderComponent | ComponentFinderComponent

export interface Pop {
    components: PopComponent[]
    postTransform?: string
}

export interface ComponentParams {
    componentId: number
    values: {[index: string]: any}
}