import {PredictedObject, StreamTime} from "@eyepop.ai/eyepop";
import {Style} from "./style";
import {CanvasRenderingContext2D} from "canvas";
import {Render} from "./render";

export class RenderBox implements Render {
    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    private readonly includeSecondaryLabels: boolean

    constructor(includeSecondaryLabels: boolean) {
        this.includeSecondaryLabels = includeSecondaryLabels
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }
    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {
        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        const x = xOffset + element.x * xScale
        const y = yOffset + element.y * yScale
        const w = element.width * xScale
        const h = element.height * yScale

        //faded blue background
        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = 1
        context.strokeStyle = style.colors.opacity_color
        context.fillStyle = style.colors.opacity_color
        context.fill()
        context.stroke()

        const mindim = Math.min(element.height, element.width)
        let corner_size = Math.max(15, mindim / 5.33333)

        var corners = [//top xOffset corner
            [{x: x, y: y + corner_size}, {x: x, y: y}, {x: x + corner_size, y: y},], //bottom xOffset corner
            [{x: x, y: y + h - corner_size}, {x: x, y: y + h}, {x: x + corner_size, y: y + h},], //top right corner
            [{x: x + w - corner_size, y: y}, {x: x + w, y: y}, {x: x + w, y: y + corner_size},], //bottom right corner
            [{x: x + w, y: y + h - corner_size}, {x: x + w, y: y + h}, {x: x + w - corner_size, y: y + h},],]

        corners.forEach((corner) => {
            context.beginPath()
            context.moveTo(corner[0].x, corner[0].y)
            context.lineTo(corner[1].x, corner[1].y)
            context.lineTo(corner[2].x, corner[2].y)
            context.strokeStyle = style.colors.primary_color
            context.lineWidth = 1
            context.stroke()
        })

        const padding = Math.max(mindim * 0.02, 5)
        corner_size = corner_size - padding

        var corners2 = [//2nd top xOffset corner
            [{x: x + padding, y: y + padding + corner_size}, {
                x: x + padding,
                y: y + padding
            }, {x: x + padding + corner_size, y: y + padding},], //2nd bottom xOffset corner
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
            context.strokeStyle = style.colors.secondary_color
            context.lineWidth = 1
            context.stroke()
        })


        let label
        if (element.traceId) {
            label = `${RenderBox.toTitleCase(element.classLabel)} #${element.traceId}`
        } else {
            label = element.classLabel
        }

        context.font = style.font
        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'top'
        const tw = context.measureText(label)
        let xPos = element.x * xScale + xOffset + 1.5*padding
        let yPos = element.y * yScale + yOffset + 1.5*padding
        context.fillText(label, xPos, yPos)
        yPos += padding + tw.actualBoundingBoxAscent + tw.actualBoundingBoxDescent

        if (element.labels) {
            for (let i= 0; i < element.labels.length; i++) {
                context.fillText(` - ${element.labels[i]}`, xPos, yPos)
                yPos += padding + tw.actualBoundingBoxAscent + tw.actualBoundingBoxDescent
            }
        }
        if (element.classes) {
            for (let i= 0; i < element.classes.length; i++) {
                context.fillText(` * ${element.classes[i].classLabel} ${Math.round(element.classes[i].confidence * 100)}%`, xPos, yPos)
                yPos += padding + tw.actualBoundingBoxAscent + tw.actualBoundingBoxDescent
            }
        }
    }

    static toTitleCase(str: string) {
        if (!str) return ''
        return str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        })
    }
}