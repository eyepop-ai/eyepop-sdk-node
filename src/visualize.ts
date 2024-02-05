import {CanvasRenderingContext2D} from "canvas"
import {PredictedObject, Prediction} from "./types";

export class EyePopPlot {
    private _context: CanvasRenderingContext2D
    private _font: string

    constructor(context: CanvasRenderingContext2D) {
        this._context = context
        const textSize = Math.floor(Math.max(1, .03 * Math.min(context.canvas.width, context.canvas.height)))
        this._font = textSize + "px Poppins"
    }

    static colors = {
        primary_color: '#2fa7d7',
        secondary_color: '#94e0ff',
        right_color: '#a1f542',
        left_color: '#e32740',
        opacity_color: 'rgba(47, 167, 215, 0.2)',
        white: "#FFFFFF",
        black: "#111111",
        blank_color: '#000000',
    }

    public prediction(p: Prediction) {
        if (p && p.objects) {
            const x_scale = this._context.canvas.width / p.source_width
            const y_scale = this._context.canvas.height / p.source_height

            for (let i = 0; i < p.objects.length; i++) {
                this.object(p.objects[i], x_scale, y_scale)
            }
        }
    }

    public object(obj: PredictedObject, x_scale: number, y_scale: number) {
        const context = this._context
        const x = obj.x * x_scale
        const y = obj.y * y_scale
        const w = obj.width * x_scale
        const h = obj.height * y_scale


        //faded blue background
        context.beginPath()
        context.rect(obj.x, obj.y, obj.width, obj.height)
        context.lineWidth = 1
        context.strokeStyle = EyePopPlot.colors.opacity_color
        context.fillStyle = EyePopPlot.colors.opacity_color
        context.fill()
        context.stroke()

        const mindim = Math.min(obj.height, obj.width)
        let corner_size = Math.max(15, mindim / 5.33333)

        var corners = [//top left corner
            [{x: x, y: y + corner_size}, {x: x, y: y}, {x: x + corner_size, y: y},], //bottom left corner
            [{x: x, y: y + h - corner_size}, {x: x, y: y + h}, {x: x + corner_size, y: y + h},], //top right corner
            [{x: x + w - corner_size, y: y}, {x: x + w, y: y}, {x: x + w, y: y + corner_size},], //bottom right corner
            [{x: x + w, y: y + h - corner_size}, {x: x + w, y: y + h}, {x: x + w - corner_size, y: y + h},],]

        corners.forEach((corner) => {
            context.beginPath()
            context.moveTo(corner[0].x, corner[0].y)
            context.lineTo(corner[1].x, corner[1].y)
            context.lineTo(corner[2].x, corner[2].y)
            context.strokeStyle = EyePopPlot.colors.primary_color
            context.lineWidth = 1
            context.stroke()
        })

        const padding = Math.max(mindim * 0.02, 5)
        corner_size = corner_size - padding

        var corners2 = [//2nd top left corner
            [{x: x + padding, y: y + padding + corner_size}, {
                x: x + padding,
                y: y + padding
            }, {x: x + padding + corner_size, y: y + padding},], //2nd bottom left corner
            [{x: x + padding, y: y - padding + h - corner_size}, {
                x: x + padding,
                y: y - padding + h
            }, {x: x + padding + corner_size, y: y - padding + h},], //2nd top right corner
            [{x: x - padding + w - corner_size, y: y + padding}, {
                x: x - padding + w,
                y: y + padding
            }, {x: x - padding + w, y: y + padding + corner_size},], //2nd bottom right corner
            [{x: x - padding + w, y: y - padding + h - corner_size}, {
                x: x - padding + w,
                y: y - padding + h
            }, {x: x - padding + w - corner_size, y: y - padding + h},],]

        corners2.forEach((corner) => {
            context.beginPath()
            context.moveTo(corner[0].x, corner[0].y)
            context.lineTo(corner[1].x, corner[1].y)
            context.lineTo(corner[2].x, corner[2].y)
            context.strokeStyle = EyePopPlot.colors.secondary_color
            context.lineWidth = 1
            context.stroke()
        })

        let trackingLabel = ''
        if (obj.traceId) {
            trackingLabel = `#${obj.traceId}`
        }

        context.font = this._font
        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'top'
        context.fillText(EyePopPlot.toTitleCase(obj.classLabel + ' ' + trackingLabel), obj.x + 1.5*padding, obj.y + 1.5* padding)

    }

    static toTitleCase(str: string) {
        if (!str) return ''
        return str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        })
    }
}