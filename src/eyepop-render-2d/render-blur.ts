import {CanvasRenderingContext2D} from "canvas";
import {Style} from "./style";
import {Render} from "./render";
import {PredictedObject} from "@eyepop.ai/eyepop";

export class RenderBlur implements Render {
    private readonly context: CanvasRenderingContext2D
    private readonly style: Style

    constructor(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public render(element: PredictedObject, left: number = 0.0, top: number = 0.0, xScale: number = 1.0, yScale: number = 1.0) {
        const context = this.context
        const x = left + element.x * xScale
        const y = top + element.y * yScale
        const w = element.width * xScale
        const h = element.height * yScale

        context.beginPath()
        context.rect(element.x, element.y, element.width, element.height)
        context.lineWidth = 1
        context.strokeStyle = this.style.colors.black
        context.fillStyle = this.style.colors.black
        context.fill()
        context.stroke()

    }
}