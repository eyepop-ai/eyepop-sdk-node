import {CanvasRenderingContext2D} from "canvas";
import {Style} from "./style";
import {PredictedKeyPoint, PredictedKeyPoints, PredictedObject} from "@eyepop.ai/eyepop";
import {Render} from "./render";

export class RenderPose implements Render {
    private readonly context: CanvasRenderingContext2D
    private readonly style: Style

    constructor(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public render(element: PredictedObject, left: number = 0.0, top: number = 0.0, xScale: number = 1.0, yScale: number = 1.0) {
        if (element.keyPoints) {
            for (let i = 0; i < element.keyPoints.length; i++) {
                const keyPoints = element.keyPoints[i]
                if (keyPoints.category == POSE_2D_CATEGORY) {
                    this.renderPose(keyPoints, POSE_2D_CONNECTIONS, Math.max(element.width, element.height), left, top, xScale, yScale)
                } else if (keyPoints.category == POSE_3D_CATEGORY) {
                    this.renderPose(keyPoints, POSE_3D_CONNECTIONS, Math.max(element.width, element.height), left, top, xScale, yScale)
                }
            }
        }
    }

    private renderPose(keyPoints: PredictedKeyPoints, connections: string[][], width: number, left: number, top: number, xScale: number, yScale: number) {
        const labelsToPoints = new Map<string, PredictedKeyPoint>()
        let maxZ = 1.0
        let minZ = -1.0
        for (let i = 0; i < keyPoints.points.length; i++) {
            const keyPoint = keyPoints.points[i]
            labelsToPoints.set(keyPoint.classLabel, keyPoint)
            if (keyPoint.z) {
                if (keyPoint.z > maxZ) {
                    maxZ = keyPoint.z
                }
                if (keyPoint.z < minZ) {
                    minZ = keyPoint.z
                }
            }
        }

        const context = this.context

        for (var i = 0; i < connections.length; i++) {
            const connection = connections[i]
            const point1 = labelsToPoints.get(connection[0])
            const point2 = labelsToPoints.get(connection[1])

            if (!point1 || !point1.x) continue

            if (!point2 || !point2.x) continue

            const x1 = left + point1.x * xScale
            const y1 = top + point1.y * yScale
            const x2 = left + point2.x * xScale
            const y2 = top + point2.y * yScale

            context.beginPath()
            context.lineWidth = 3
            context.strokeStyle = this.style.colors.primary_color
            context.fillStyle = this.style.colors.primary_color
            context.moveTo(x1, y1)
            context.lineTo(x2, y2)
            context.stroke()
            context.closePath()
        }

        const MIN_RADIUS = 2;
        const MAX_RADIUS = width / 40;

        for (var i = 0; i < keyPoints.points.length; i++) {
            const p = keyPoints.points[i]
            const x = left + p.x * xScale
            const y = top + p.y * yScale
            const z = p.z ?? 0.0 * Math.max(xScale, yScale)
            const radius = MAX_RADIUS - (z - minZ) * (MAX_RADIUS - MIN_RADIUS) / (maxZ - minZ)

            //draw circle
            context.beginPath()
            context.arc(x, y, radius, 0, Math.PI * 2, false)
            if (p.classLabel.includes('left')) {
                context.fillStyle = this.style.colors.left_color
            } else if (p.classLabel.includes('right')) {
                context.fillStyle = this.style.colors.right_color
            } else {
                context.fillStyle = this.style.colors.primary_color
            }
            context.fill()
            context.strokeStyle = this.style.colors.secondary_color
            context.stroke()
        }
    }
}

const POSE_2D_CATEGORY = '2d-body-points'
const POSE_3D_CATEGORY = '3d-body-points'

const POSE_2D_CONNECTIONS = [['left shoulder', 'right shoulder'], ['left hip', 'right hip'],

    ['left shoulder', 'left elbow'], ['left elbow', 'left wrist'], ['left shoulder', 'right hip'], ['left hip', 'left knee'], ['left knee', 'left ankle'],

    ['right shoulder', 'right elbow'], ['right elbow', 'right wrist'], ['right shoulder', 'left hip'], ['right hip', 'right knee'], ['right knee', 'right ankle'],]

const POSE_3D_CONNECTIONS = [['mouth (right)', 'mouth (left)'], ['right ear', 'right eye (outer)'], ['right eye (outer)', 'right eye'], ['right eye', 'right eye (inner)'], ['right eye (inner)', 'nose'], ['nose', 'left eye (inner)'], ['left eye (inner)', 'left eye'], ['left eye', 'left eye (outer)'], ['left eye (outer)', 'left ear'],

    ['right shoulder', 'left shoulder'], ['left shoulder', 'right hip'], ['left hip', 'right hip'], ['left hip', 'right shoulder'],

    ['right shoulder', 'right elbow'], ['right elbow', 'right wrist'], ['right wrist', 'right thumb'], ['right wrist', 'right pinky'], ['right wrist', 'right index'], ['right pinky', 'right index'],

    ['left shoulder', 'left elbow'], ['left elbow', 'left wrist'], ['left wrist', 'left thumb'], ['left wrist', 'left pinky'], ['left wrist', 'left index'], ['left pinky', 'left index'],

    ['right hip', 'right knee'], ['right knee', 'right ankle'], ['right ankle', 'right foot index'], ['right ankle', 'right heel'], ['right heel', 'right foot index'],

    ['left hip', 'left knee'], ['left knee', 'left ankle'], ['left ankle', 'left foot index'], ['left ankle', 'left heel'], ['left heel', 'left foot index'],]

