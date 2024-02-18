import {CanvasRenderingContext2D} from "canvas";
import {Style} from "./style";
import {StreamTime} from "@eyepop.ai/eyepop";

export interface Render {
    start(context: CanvasRenderingContext2D, style: Style): void

    draw(element: any, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void
}