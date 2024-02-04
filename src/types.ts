export interface Session {
    readonly accessToken: string;
    readonly validUntil: Date;
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