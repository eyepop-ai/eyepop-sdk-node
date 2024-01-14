export interface PredictedObject {
    id: number
    traceId: number | undefined
    x: number
    y: number
    width: number
    height: number
    orientation: number
    confidence: number
    classLabel: string
    objects: Array<PredictedObject>
}
export interface Prediction {
    timestamp: number
    seconds: number
    offset: number
    source_width: number
    source_height: number
    source_id: string
    objects: Array<PredictedObject>
    classes: Array<Object>
    labels: Array<string>
    meshs: Array<Object>
    keyPoints: Array<Object>
}