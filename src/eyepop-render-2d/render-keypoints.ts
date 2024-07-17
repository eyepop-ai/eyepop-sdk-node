import { CanvasRenderingContext2D } from "canvas";
import { Style } from "./style";
import { PredictedKeyPoint, PredictedKeyPoints, PredictedObject, StreamTime } from "@eyepop.ai/eyepop";
import { Render, DEFAULT_TARGET, RenderTarget } from "./render";

export type RenderKeyPointsOptions = { showLabels: boolean } & RenderTarget
export class RenderKeyPoints implements Render
{
    public target: string = DEFAULT_TARGET
    public showLabels: boolean = false

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    constructor(options: Partial<RenderKeyPointsOptions> = {})
    {
        const { showLabels = false, target = '$..objects[?(@.keyPoints)]' } = options;
        this.target = target;
        this.showLabels = showLabels
    }


    start(context: CanvasRenderingContext2D, style: Style)
    {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void
    {
        if (element.keyPoints)
        {
            const style = this.style
            if (!style)
            {
                throw new Error('render() called before start()')
            }
            let fillColor = style.colors.primary_color
            for (let i = 0; i < element.keyPoints.length; i++)
            {
                const keyPoints = element.keyPoints[ i ]
                this.renderKeyPoints(keyPoints, fillColor, Math.max(element.width, element.height), xOffset, yOffset, xScale, yScale)
            }
        }
    }

    private renderKeyPoints(keyPoints: PredictedKeyPoints, fillColor: string, width: number, xOffset: number, yOffset: number, xScale: number, yScale: number)
    {
        let maxZ = 1.0
        let minZ = -1.0
        for (let i = 0; i < keyPoints.points.length; i++)
        {
            const keyPoint = keyPoints.points[ i ]
            if (keyPoint.z)
            {
                if (keyPoint.z > maxZ)
                {
                    maxZ = keyPoint.z
                }
                if (keyPoint.z < minZ)
                {
                    minZ = keyPoint.z
                }
            }
        }

        const context = this.context
        const style = this.style
        if (!context || !style)
        {
            throw new Error('render() called before start()')
        }

        const MIN_RADIUS = 2;
        const MAX_RADIUS = Math.min(MIN_RADIUS * 2, width / 100);

        for (var i = 0; i < keyPoints.points.length; i++)
        {
            const p = keyPoints.points[ i ]
            const x = xOffset + p.x * xScale
            const y = yOffset + p.y * yScale
            const z = p.z ?? 0.0 * Math.max(xScale, yScale)
            const radius = MAX_RADIUS - (z - minZ) * (MAX_RADIUS - MIN_RADIUS) / (maxZ - minZ)

            //draw circle
            context.beginPath()
            context.arc(x, y, radius, 0, Math.PI * 2, false)
            context.fillStyle = fillColor
            context.fill()
            context.strokeStyle = style.colors.secondary_color
            context.stroke()

            if (!this.showLabels) continue

            // label
            let label
            if (typeof p.visible == 'undefined')
            {
                label = p.classLabel
            } else
            {
                label = `${p.classLabel} (${p.visible ? "visible" : "invisible"})`
            }

            context.font = style.font
            context.fillStyle = '#ffffff'
            context.textAlign = 'left'
            context.textBaseline = 'top'
            const tw = context.measureText(label)
            let xPos = p.x * xScale + xOffset + radius
            let yPos = p.y * yScale + yOffset - (radius + tw.actualBoundingBoxAscent + tw.actualBoundingBoxDescent)
            context.fillText(label, xPos, yPos)
        }
    }
}
