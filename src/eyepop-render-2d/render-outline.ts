import {Point2d, PredictedObject, StreamTime} from "@eyepop.ai/eyepop";
import {Style} from "./style";
import {CanvasRenderingContext2D} from "canvas";
import {Render} from "./render";

export class RenderOutline implements Render {
    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }
    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {

        if (!element.outline || !element.outline.length) {
            return
        }

        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        //faded blue background
        context.beginPath()
        context.lineWidth = 1
        context.strokeStyle = style.colors.primary_color
        context.fillStyle = style.colors.opacity_color
        context.moveTo(element.outline[0].x, element.outline[0].y)
        for (let i = 1; i < element.outline.length; i++) {
            context.lineTo(element.outline[i].x, element.outline[i].y)
        }
        context.closePath()
        context.fill()
        context.stroke()
    }
}