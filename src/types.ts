export interface Prediction {
    timestamp: number
    seconds: number
    offset: number
    source_width: number
    source_height: number
    source_id: string
    object: Array<Object>
    classes: Array<Object>
    labels: Array<string>
    meshs: Array<Object>
    keyPoints: Array<Object>
}