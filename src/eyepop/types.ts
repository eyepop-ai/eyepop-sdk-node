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
    timestamp?: number
    /**
     * Convenience, same vale as 'timestamp' just in seconds.
     */
    seconds?: number
    /**
     * Temporal length of the chunk that was the source for this prediction in nano seconds.
     */
    duration?: number
    /**
     * Real time when the media was captured as epoch timestamp in nano seconds.
     *
     * Only provided if source provides this timestamp e.g. as timestamp/x-ntp in RTSP.
     */
    captured_at?: number
    /**
     * A media specific offset.
     *
     * For video frames, this is the frame number of prediction.
     * For audio samples, this is the offset of the first sample for this prediction.
     */
    offset?: number
    /**
     * Offset length of the chunk used for this prediction.
     *
     * It has the same format as offset.
     */
    offset_duration?: number
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
    details?: Array<Map<string, any>>
    motions?: Array<PredictedMotion>
    depth?: Depth
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

/**
 * A segmentation mask, optionally with a per-object point cloud.
 *
 * `world` is the base64 encoding of three little-endian float32 values per mask
 * pixel, row-major, exactly width*height triples - so the point for bitmap
 * pixel (i, j) is at triple index j * width + i. Points the worker could not
 * place are NaN. Use decodePointCloud() to read it.
 */
export interface Mask {
    bitmap: string
    width: number
    height: number
    stride: number
    world?: string
}

/**
 * A frame-level depth map as produced by depth estimation abilities
 * (e.g. eyepop.depth.*).
 *
 * `values` is the base64 encoding of width*height little-endian float32
 * values in row-major order. The map always has the aspect ratio of the
 * source frame; map a source coordinate (x, y) to the map proportionally:
 * (x * width / source_width, y * height / source_height).
 *
 * Sky pixels carry +Infinity. Use decodeDepthMap() to access the values.
 *
 * `semantic` says what the values mean, and is always present in prediction v2 -
 * "unknown" included - so an absent member means a worker that predates the
 * field rather than a map that declined to say:
 *
 * - "canonical_metric" - metres = value * focal_px / 300, with focal_px scaled
 *   to the map's own resolution
 * - "metric" - the value is already metres
 * - "relative" - scale- AND shift-invariant, so ordering is meaningful but
 *   distance is not. Not back-projectable: recovering a cloud from it yields a
 *   distorted scene rather than a scaled one
 * - "unknown" - the ability declared nothing. Not back-projectable
 *
 * `world` is the scene point cloud, present when the Pop asked for
 * `depthMap.toWorld`. Same encoding as `Mask.world` - three little-endian
 * float32 per pixel, row-major - but on this map's own grid, so the point for
 * pixel (i, j) is at triple index j * width + i, exactly where that pixel's
 * value sits in `values`. Points the worker could not place are NaN; the value
 * at the same index is what says why, which is why both are sent.
 */
export interface Depth {
    width: number
    height: number
    values: string
    semantic?: DepthSemantic
    world?: string
}

export type DepthSemantic = 'canonical_metric' | 'metric' | 'relative' | 'unknown'

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
    details?: Array<Map<string, any>>
}

/**
 * A point in source pixels, optionally placed in 3D.
 *
 * `worldX`/`worldY`/`worldZ` are metres, present only when the pipeline was
 * asked for world coordinates - a Pop with `depthMap` and a component with
 * `toWorld` - and only in prediction v2. A point the worker could not place -
 * sky, outside the depth map, no usable map - carries none of the three rather
 * than a zero or a NaN, so test for undefined.
 *
 * Which frame they are in depends on the source's camera: with extrinsics, the
 * world frame those define (Z up, ground at Z = 0); without them, the camera
 * frame in the OpenCV convention (X right, Y down, Z forward from the camera).
 *
 * Only the carriers the worker enriches ever populate them: key points, outline
 * points and contour points. Bounding boxes and mesh points do not - a box is
 * not a point, and any single anchor choice would be arbitrary.
 */
export interface Point2d {
    x: number
    y: number
    worldX?: number
    worldY?: number
    worldZ?: number
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
