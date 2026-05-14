export interface Session {
    readonly eyepopUrl: string
    readonly accessToken: string
    readonly validUntil: number
}

export enum EndpointState {
    Idle = 'Idle',
    Busy = 'Busy',
    Authenticating = 'Authenticating',
    FetchConfig = 'FetchConfig',
    Error = 'Error',
    NotAvailable = 'NotAvailable',
}

export interface Box {
    readonly topLeft: Point2d
    readonly bottomRight: Point2d
}

export interface StreamTime {
    /**
     * Temporal offset of prediction from start of the media (video or audio) in nano seconds.
     */
    timestamp?: number;
    /**
     * Convenience, same vale as 'timestamp' just in seconds.
     */
    seconds?: number;
    /**
     * Temporal length of the chunk that was the source for this prediction in nano seconds.
     */
    duration?: number;
    /**
     * Real time when the media was captured as epoch timestamp in nano seconds.
     *
     * Only provided if source provides this timestamp e.g. as timestamp/x-ntp in RTSP.
     */
    captured_at?: number;
    /**
     * A media specific offset.
     *
     * For video frames, this is the frame number of prediction.
     * For audio samples, this is the offset of the first sample for this prediction.
     */
    offset?: number;
    /**
     * Offset length of the chunk used for this prediction.
     *
     * It has the same format as offset.
     */
    offset_duration?: number;
}

export interface Prediction extends StreamTime {
    /**
     * The width of the source coordinate system for all prediction coordinates.
     */
    source_width: number
    /**
     * The height of the source coordinate system for all prediction coordinates.
     */
    source_height: number
    source_id?: string
    source_url?: string
    source_type?: string
    system_timestamp?: number
    objects?: Array<PredictedObject>
    classes?: Array<PredictedClass>
    texts?: Array<PredictedText>
    meshs?: Array<PredictedMesh>
    keyPoints?: Array<PredictedKeyPoints>
    embeddings?: Array<PredictedEmbedding>
    motions?: Array<PredictedMotion>
}

export interface PredictedClass {
    id?: number
    confidence?: number
    classLabel: string
    category?: string
}

export interface PredictedText {
    id?: number
    confidence?: number
    text: string
    category?: string
}

export interface PredictedEmbedding {
    x?: number
    y?: number
    embedding: Array<number>
    category?: string
}

export interface Contour {
    points: Array<Point2d>
    cutouts: Array<Array<Point2d>>
}

export interface Mask {
    bitmap: string
    width: number
    height: number
    stride: number
}

export interface PredictedObject extends PredictedClass {
    trackId?: number
    x: number
    y: number
    width: number
    height: number
    orientation?: number
    outline?: Array<Point2d>
    contours?: Array<Contour>
    mask?: Mask
    objects?: Array<PredictedObject>
    classes?: Array<PredictedClass>
    texts?: Array<PredictedText>
    meshs?: Array<PredictedMesh>
    keyPoints?: Array<PredictedKeyPoints>
}

export interface Point2d {
    x: number
    y: number
}

export interface PredictedMesh {
    category?: string
    id?: number
    confidence?: number
    points: Array<Point3d>
}

export interface Point3d extends Point2d {
    z?: number
}

export interface PredictedKeyPoints {
    category?: string
    type?: string
    points: Array<PredictedKeyPoint>
}

export interface PredictedKeyPoint extends Point3d {
    id?: number
    confidence?: number
    classLabel?: string
    category?: string
    visible?: boolean
}

export interface PredictedMotion {
    begin_timestamp: number
    finished_timestamp: number | undefined
}
