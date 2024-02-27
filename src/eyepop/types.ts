export interface Session {
    readonly eyepopUrl: string;
    readonly popId: string;
    readonly accessToken: string;
    readonly validUntil: number;
}

export interface SessionPlus extends Session {
    readonly baseUrl: string;
    readonly pipelineId: string;
}

export enum EndpointState {
    Idle = "Idle",
    Busy = "Busy",
    Authenticating = "Authenticating",
    FetchConfig = "FetchConfig",
    StartingPop = "StartingPop",
    Error = "Error"
}

export interface LiveMedia {
    ingressId(): string
    stream(): Promise<MediaStream>
    close(): Promise<void>
}
export interface IngressEvent {
    readonly ingressId: string
    readonly event: "stream-ready" | "stream-ready"
}

export interface FileSource {
    readonly file: File;
}

export interface StreamSource {
    readonly stream: ReadableStream<Uint8Array>;
    readonly mimeType: string;
}

export interface PathSource {
    readonly path: string;
}

export interface LiveSource {
    readonly ingressId: string;
}

export interface UrlSource {
    readonly url: string;
}

export type Source = FileSource | StreamSource | PathSource | LiveSource | UrlSource

export interface Box {
    readonly topLeft: Point2d
    readonly bottomRight: Point2d
}

export interface Roi {
    readonly points: Point2d[] | undefined
    readonly boxes: Box[] | undefined
}
export interface SourceParams {
    readonly roi: Roi | undefined
}

export interface StreamTime {
    timestamp: number
    seconds: number
    offset: number
}
export interface Prediction extends StreamTime {
    source_width: number
    source_height: number
    source_id: string
    objects: Array<PredictedObject>
    classes: Array<PredictedClass>
    labels: Array<string>
    meshs: Array<PredictedMesh>
    keyPoints: Array<PredictedKeyPoints>
}
export interface PredictedClass {
    id: number
    confidence: number
    classLabel: string
    category: string
}

export interface PredictedObject extends PredictedClass {
    traceId: number | undefined
    x: number
    y: number
    width: number
    height: number
    orientation: number
    outline: Array<Point2d>
    objects: Array<PredictedObject>
    classes: Array<PredictedClass>
    labels: Array<string>
    meshs: Array<PredictedMesh>
    keyPoints: Array<PredictedKeyPoints>
}

export interface Point2d {
    x: number
    y: number
}

export interface PredictedMesh {
    category: string
    id: number
    confidence: number
    points: Array<Point3d>
}

export interface Point3d extends Point2d {
    z: number | undefined
}

export interface PredictedKeyPoints {
    category: string
    type: string
    points: Array<PredictedKeyPoint>
}

export interface PredictedKeyPoint extends Point3d, PredictedClass {
}

export interface ResultStream extends AsyncIterable<Prediction> {
    cancel(): void
}