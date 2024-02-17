import {CanvasRenderingContext2D} from "canvas";

export interface Colors {
        primary_color: string
        secondary_color: string
        right_color: string
        left_color: string
        opacity_color: string
        white: string
        black: string
        blank_color: string
}
export class Style {
    readonly font: string
    readonly colors: Colors

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
    constructor(context: CanvasRenderingContext2D) {
        const textSize = Math.floor(Math.max(1, .03 * Math.min(context.canvas.width, context.canvas.height)))
        this.font = textSize + "px Poppins"
        this.colors = Style.defaultColors
    }
}