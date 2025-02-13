import { Point2d, PredictedObject, StreamTime } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { CanvasRenderingContext2D } from 'canvas'
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderContourOptions = {} & RenderTarget

export class RenderContour implements Render {
    public target: string = DEFAULT_TARGET

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    constructor(options: Partial<RenderContourOptions> = {}) {
        const { target = '$..objects[?(@.contours)]' } = options
        this.target = target
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {
        if (!element.contours || !element.contours.length) {
            return
        }

        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        const lineWidth = Math.max(1, Math.max(context.canvas.width, context.canvas.height) / 360)

        for (let j = 0; j < element.contours.length; j++) {
            const contour = element.contours[j]

            if (contour.points.length < 2) {
                continue
            }
            //faded blue background
            context.beginPath()
            context.lineWidth = lineWidth
            context.strokeStyle = style.colors.primary_color
            context.fillStyle = style.colors.opacity_color
            let p = contour.points[contour.points.length - 1]
            context.moveTo(p.x * xScale + xOffset, p.y * yScale + yOffset)
            for (let i = 0; i < contour.points.length; i++) {
                p = contour.points[i]
                context.lineTo(p.x * xScale + xOffset, p.y * yScale + yOffset)
            }

            context.closePath()
            context.stroke()

            if (contour.cutouts && contour.cutouts.length) {
                for (let k = 0; k < contour.cutouts.length; k++) {
                    const points = contour.cutouts[k]
                    if (points.length < 2) {
                        continue
                    }
                    p = points[points.length - 1]
                    context.moveTo(p.x * xScale + xOffset, p.y * yScale + yOffset)
                    for (let i = 0; i < points.length; i++) {
                        p = points[i]
                        context.lineTo(p.x * xScale + xOffset, p.y * yScale + yOffset)
                    }
                    context.closePath()
                    context.stroke()
                }
            }

            context.fill()
        }
    }
}
