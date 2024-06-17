import { CanvasRenderingContext2D } from "canvas";
import { Style } from "./style";
import { Render, DEFAULT_TARGET, RenderTarget } from './render';
import { StreamTime, PredictedObject } from "@eyepop.ai/eyepop";

type RenderBlurOptions = {} & RenderTarget

export class RenderBlur implements Render
{
    public target: string = DEFAULT_TARGET

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    constructor(options: Partial<RenderBlurOptions> = {})
    {
        const { target = DEFAULT_TARGET } = options;
        this.target = target;
    }

    start(context: CanvasRenderingContext2D, style: Style)
    {
        this.context = context
        this.style = style
    }

    public draw(object: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void
    {
        const context = this.context
        const style = this.style
        if (!context || !style)
        {
            throw new Error('render() called before start()')
        }
        const x = xOffset + object.x * xScale
        const y = yOffset + object.y * yScale
        const w = object.width * xScale
        const h = object.height * yScale

        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = style.scale
        context.strokeStyle = style.colors.black
        context.fillStyle = style.colors.black
        context.fill()
        context.stroke()
    }
}

export default RenderBlur
