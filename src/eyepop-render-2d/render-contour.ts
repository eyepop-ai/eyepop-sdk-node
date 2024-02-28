import {Point2d, PredictedObject, StreamTime} from "@eyepop.ai/eyepop";
import {Style} from "./style";
import {CanvasRenderingContext2D} from "canvas";
import {Render} from "./render";

export class RenderContour implements Render {
    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }
    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {

        if (!element.outerContours || !element.outerContours.length) {
            return
        }

        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        for (let j = 0; j < element.outerContours.length; j++) {
            const contour = element.outerContours[j].points

            //faded blue background
            context.beginPath()
            context.lineWidth = 5
            context.strokeStyle = style.colors.primary_color
            context.fillStyle = style.colors.opacity_color
            context.moveTo(contour[0].x, contour[0].y)
            for (let i = 1; i < contour.length; i++) {
                context.lineTo(contour[i].x, contour[i].y)
            }
            context.closePath()
            context.fill()
            context.stroke()
        }
    }
}