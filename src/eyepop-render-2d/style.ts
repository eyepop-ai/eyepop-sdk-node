import { CanvasRenderingContext2D } from "canvas";
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
    public cornerWidth: number = .33
    public cornerPadding: number = 0.04

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
        this.scale = this.calculateScale(context) * 2
    }

    private calculateFont(w: number, h: number): string
    {
        const textSize = Math.floor(Math.max(12, .035 * Math.min(w, h)))
        return textSize + "px Times New Roman";
    }

    private calculateScale(context: CanvasRenderingContext2D): number
    {
        const _screen = (typeof (screen) == "undefined") ? null : screen
        const _window = (typeof (window) == "undefined") ? null : window
        const width = _screen?.width ?? context.canvas.width;
        const height = _screen?.height ?? context.canvas.height;

        // This scale provides a normalizing value of the canvas size to the screen size,
        //   allowing context drawing of the same size objects on different sized canvases/screens.
        const scale = Math.max(context.canvas.width / width, context.canvas.height / height) * (_window?.devicePixelRatio ?? 1);
        return scale;
    }
}
