import { Canvas, CanvasRenderingContext2D } from "canvas";
import { ResizeObserver } from '@juggle/resize-observer';
export interface Colors
{
    primary_color: string
    secondary_color: string
    right_color: string
    left_color: string
    opacity_color: string
    white: string
    black: string
    blank_color: string
}
export class Style
{
    public font: string
    public colors: Colors
    public scale: number = 1.0
    public cornerWidth: number = .25
    public cornerPadding: number = 0.025

    private static defaultColors = {
        primary_color: '#2fa7d7',
        secondary_color: '#94e0ff',
        right_color: '#a1f542',
        left_color: '#e32740',
        opacity_color: 'rgba(47, 167, 215, 0.2)',
        white: "#FFFFFF",
        black: "#111111",
        blank_color: '#000000',
    }

    constructor(context: CanvasRenderingContext2D)
    {
        this.colors = Style.defaultColors
        if ('document' in globalThis && 'implementation' in globalThis.document)
        {
            const resizeObserver = new ResizeObserver(entries =>
            {
                const rect = entries[ 0 ].contentRect
                this.font = this.calculateFont(rect.width, rect.height)
                this.scale = this.calculateScale(context)
            })
            // @ts-ignore
            resizeObserver.observe(context.canvas)
        }

        this.font = this.calculateFont(context.canvas.width, context.canvas.height)
        this.scale = this.calculateScale(context)
    }

    private calculateFont(w: number, h: number): string
    {
        const textSize = Math.floor(Math.max(18, .025 * Math.min(w, h)))
        return textSize + "px Times New Roman";
    }

    private calculateScale(context: CanvasRenderingContext2D): number
    {
        const width = screen?.width ?? context.canvas.width;
        const height = screen?.height ?? context.canvas.height;

        // This scale provides a normalizing value of the canvas size to the screen size,
        //   allowing context drawing of the same size objects on different sized canvases/screens.
        const scale = Math.max(context.canvas.width / width, context.canvas.height / height) * (window.devicePixelRatio || 1);
        return scale;
    }
}
