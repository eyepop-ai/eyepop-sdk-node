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

export interface LiveIngress {
    ingressId(): string
    close(): Promise<void>
}
export interface IngressEvent {
    readonly ingressId?: string
    readonly event?: "stream-ready" | "stream-ready"
}

export interface UploadParams {
    readonly filePath?: string | undefined;
    readonly file?: File | undefined;
    readonly mimeType?: string | undefined;
}

export interface Prediction {
    timestamp: number
    seconds: number
    offset: number
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
    id: number
    confidence: number
    points: Array<Point3d>
}

export interface Point3d extends Point2d {
    z: number | undefined
}

export interface PredictedKeyPoints {
    type: string
    points: Array<PredictedKeyPoint>
}

export interface PredictedKeyPoint extends Point3d, PredictedClass {
}

export interface ResultStream extends AsyncIterable<Prediction> {
    cancel(): void
}