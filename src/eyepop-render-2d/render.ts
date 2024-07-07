import { CanvasRenderingContext2D } from "canvas";
import { Style } from "./style";
import { StreamTime } from "@eyepop.ai/eyepop";

export const DEFAULT_TARGET = "$..objects[?(@.category=='person')]";
export interface RenderTarget
{
    target: string
}

export interface Render extends RenderTarget
{
    start(context: CanvasRenderingContext2D, style: Style): void

    draw(element: any, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime,color?:string): void
}

