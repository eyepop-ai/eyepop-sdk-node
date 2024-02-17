import {CanvasRenderingContext2D} from "canvas";
import {Style} from "./style";
import {PredictedKeyPoint, PredictedKeyPoints, PredictedObject} from "@eyepop.ai/eyepop";
import {Render} from "./render";

export class RenderHand implements Render {
    private readonly context: CanvasRenderingContext2D
    private readonly style: Style

    constructor(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public render(element: PredictedObject, left: number = 0.0, top: number = 0.0, xScale: number = 1.0, yScale: number = 1.0) {
        if (element.keyPoints) {
            let fillColor = this.getFillColor(element)
            for (let i = 0; i < element.keyPoints.length; i++) {
                const keyPoints = element.keyPoints[i]
                if (keyPoints.category == HAND_KEYPOINTS_CATEGORY) {
                    this.renderKeyPoints(keyPoints, fillColor, Math.max(element.width, element.height), left, top, xScale, yScale)
                }
            }
        }
    }

    private renderKeyPoints(keyPoints: PredictedKeyPoints, fillColor: string, width: number, left: number, top: number, xScale: number, yScale: number) {
        const labelsToPoints = new Map<string, PredictedKeyPoint>()
        let maxZ = 0;
        let minZ = 0;
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
        for (var i = 0; i < HAND_CONNECTIONS.length; i++) {
            const connection = HAND_CONNECTIONS[i]
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
            context.fillStyle = fillColor
            context.fill()
            context.strokeStyle = this.style.colors.secondary_color
            context.stroke()
        }
    }

    private getFillColor(element: PredictedObject) {
        let fillColor = this.style.colors.primary_color
        if (element.classes) {
            for (let i = 0; i < element.classes.length; i++) {
                if (element.classes[i].category == HAND_KEYPOINTS_CATEGORY) {
                    if (element.classes[i].classLabel == "right") {
                        fillColor = this.style.colors.right_color
                        break
                    } else if (element.classes[i].classLabel == "left") {
                        fillColor = this.style.colors.left_color
                        break
                    }
                }
            }
        }
        return fillColor;
    }
}

const HAND_KEYPOINTS_CATEGORY = '3d-hand-points'

const HAND_CONNECTIONS = [['wrist', 'thumb cmc'], ['thumb cmc', 'thumb mcp'], ['thumb mcp', 'thumb ip'], ['thumb ip', 'thumb tip'],

    ['wrist', 'index finger mcp'], ['index finger mcp', 'index finger pip'], ['index finger pip', 'index finger dip'], ['index finger dip', 'index finger tip'],

    ['wrist', 'middle finger mcp'], ['middle finger mcp', 'middle finger pip'], ['middle finger pip', 'middle finger dip'], ['middle finger dip', 'middle finger tip'],

    ['wrist', 'ring finger mcp'], ['ring finger mcp', 'ring finger pip'], ['ring finger pip', 'ring finger dip'], ['ring finger dip', 'ring finger tip'],

    ['wrist', 'pinky mcp'], ['pinky mcp', 'pinky pip'], ['pinky pip', 'pinky dip'], ['pinky dip', 'pinky tip'],

    ['index finger mcp', 'middle finger mcp'], ['middle finger mcp', 'ring finger mcp'], ['ring finger mcp', 'pinky mcp'],]
