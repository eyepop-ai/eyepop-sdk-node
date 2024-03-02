import {Point2d, PredictedObject, StreamTime} from "@eyepop.ai/eyepop";
import {Style} from "./style";
import {CanvasRenderingContext2D} from "canvas";
import {Render} from "./render";

export class RenderMask implements Render {
    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }
    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {

        if (!element.mask) {
            return
        }

        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        const buffer = Buffer.from(element.mask.bitmap, 'base64')
        const offscreenCanvas = new OffscreenCanvas(element.mask.width, element.mask.height)
        const offscreenContext = offscreenCanvas.getContext("2d")

        if (!offscreenContext) {
            throw new Error('cannot render a mask without offscreen context')
        }

        const aPixel = offscreenContext.createImageData(1,1)
        const d  = aPixel.data;
        d[0] = 80;
        d[1] = 80;
        d[2] = 80;
        d[3] = 128;
        for (let y = 0; y < element.mask.height; y++) {
            const line= y * element.mask.stride
            for (let s= 0; s < element.mask.stride; s++) {
                const byte = buffer[line + s]
                for (let p= 0; p < 8; p++) {
                    const x = s * 8 + p
                    if (x >= element.mask.width) {
                        break
                    }
                    const bit = (byte >> (7 - (p % 8))) & 1
                    if (bit) {
                        offscreenContext.putImageData(aPixel, x, y)
                    }
                }
            }
        }
        const bitmap = offscreenCanvas.transferToImageBitmap()

        context.drawImage(
            // @ts-ignore - wouldn't work for node, but then we errored out above already
            bitmap,
            element.x + xOffset,
            element.y + yOffset,
            element.width * xScale,
            element.height * yScale)
    }
}