import {CanvasRenderingContext2D} from "canvas";
import {Style} from "./style";
import {Render} from "./render";
import {StreamTime, PredictedObject} from "@eyepop.ai/eyepop";

export class RenderBlur implements Render {
    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }
    public draw(object: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {
        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }
        const x = xOffset + object.x * xScale
        const y = yOffset + object.y * yScale
        const w = object.width * xScale
        const h = object.height * yScale

        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = 1
        context.strokeStyle = style.colors.black
        context.fillStyle = style.colors.black
        context.fill()
        context.stroke()
    }
}

export default RenderBlur