import {PredictedObject} from "@eyepop.ai/eyepop";
import {Style} from "./style";
import {CanvasRenderingContext2D} from "canvas";
import {Render} from "./render";

export class RenderBox implements Render {
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

        //faded blue background
        context.beginPath()
        context.rect(element.x, element.y, element.width, element.height)
        context.lineWidth = 1
        context.strokeStyle = this.style.colors.opacity_color
        context.fillStyle = this.style.colors.opacity_color
        context.fill()
        context.stroke()

        const mindim = Math.min(element.height, element.width)
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
            context.strokeStyle = this.style.colors.primary_color
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
            context.strokeStyle = this.style.colors.secondary_color
            context.lineWidth = 1
            context.stroke()
        })

        let trackingLabel = ''
        if (element.traceId) {
            trackingLabel = `#${element.traceId}`
        }

        context.font = this.style.font
        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'top'
        context.fillText(RenderBox.toTitleCase(element.classLabel + ' ' + trackingLabel), element.x + 1.5*padding, element.y + 1.5* padding)
    }

    static toTitleCase(str: string) {
        if (!str) return ''
        return str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        })
    }
}