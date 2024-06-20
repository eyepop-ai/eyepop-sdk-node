import { PredictedObject, StreamTime } from "@eyepop.ai/eyepop"
import { Style } from "./style"
import { CanvasRenderingContext2D } from "canvas"
import { Render, DEFAULT_TARGET, RenderTarget } from './render'


type RenderBoxOptions = {
    showText: boolean // Whether to show labels, such as OCR text
    showClass: boolean // Whether to show class labels, such as "person"
    showNestedClasses: boolean // Whether to show nested classes, such as "person" + "necklace"
    showConfidence: boolean // Whether to show confidence, such as "0.95"
    showTraceId: boolean // Whether to show trace ID, such as "132"
} & RenderTarget

export class RenderBox implements Render
{
    public target: string = DEFAULT_TARGET

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined
    private showText: boolean
    private showClass: boolean
    private showNestedClasses: boolean
    private showConfidence: boolean
    private showTraceId: boolean

    constructor(options: Partial<RenderBoxOptions> = {})
    {
        const { showClass = true, showText = true, showConfidence = false, showTraceId = false, showNestedClasses = false, target = DEFAULT_TARGET } = options
        this.target = target

        this.showClass = showClass
        this.showNestedClasses = showNestedClasses
        this.showText = showText
        this.showConfidence = showConfidence
        this.showTraceId = showTraceId
    }

    start(context: CanvasRenderingContext2D, style: Style)
    {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void
    {
        const context = this.context
        const style = this.style
        if (!context || !style)
        {
            throw new Error('render() called before start()')
        }

        const x = xOffset + element.x * xScale
        const y = yOffset + element.y * yScale
        const w = element.width * xScale
        const h = element.height * yScale

        //faded blue background
        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = style.scale
        context.strokeStyle = style.colors.opacity_color
        context.fillStyle = style.colors.opacity_color
        context.fill()
        context.stroke()

        const mindim = Math.min(element.height, element.width)
        let corner_size = Math.max(15, mindim / 5.33333)

        var corners = [//top left corner
            [ { x: x, y: y + corner_size }, { x: x, y: y }, { x: x + corner_size, y: y }, ], //bottom left corner
            [ { x: x, y: y + h - corner_size }, { x: x, y: y + h }, { x: x + corner_size, y: y + h }, ], //top right corner
            [ { x: x + w - corner_size, y: y }, { x: x + w, y: y }, { x: x + w, y: y + corner_size }, ], //bottom right corner
            [ { x: x + w, y: y + h - corner_size }, { x: x + w, y: y + h }, { x: x + w - corner_size, y: y + h }, ], ]

        corners.forEach((corner) =>
        {
            context.beginPath()
            context.moveTo(corner[ 0 ].x, corner[ 0 ].y)
            context.lineTo(corner[ 1 ].x, corner[ 1 ].y)
            context.lineTo(corner[ 2 ].x, corner[ 2 ].y)
            context.strokeStyle = style.colors.primary_color
            context.lineWidth = style.scale
            context.stroke()
        })

        const padding = Math.max(mindim * 0.02, 5)
        corner_size = corner_size - padding

        var corners2 = [//2nd top left corner
            [ { x: x + padding, y: y + padding + corner_size }, {
                x: x + padding,
                y: y + padding
            }, { x: x + padding + corner_size, y: y + padding }, ], //2nd bottom left corner
            [ { x: x + padding, y: y - padding + h - corner_size }, {
                x: x + padding,
                y: y - padding + h
            }, { x: x + padding + corner_size, y: y - padding + h }, ], //2nd top right corner
            [ { x: x - padding + w - corner_size, y: y + padding }, {
                x: x - padding + w,
                y: y + padding
            }, { x: x - padding + w, y: y + padding + corner_size }, ], //2nd bottom right corner
            [ { x: x - padding + w, y: y - padding + h - corner_size }, {
                x: x - padding + w,
                y: y - padding + h
            }, { x: x - padding + w - corner_size, y: y - padding + h }, ], ]

        corners2.forEach((corner) =>
        {
            context.beginPath()
            context.moveTo(corner[ 0 ].x, corner[ 0 ].y)
            context.lineTo(corner[ 1 ].x, corner[ 1 ].y)
            context.lineTo(corner[ 2 ].x, corner[ 2 ].y)
            context.strokeStyle = style.colors.secondary_color
            context.lineWidth = style.scale
            context.stroke()
        })

        const boundingBoxWidth = element.width * xScale - 3 * padding
        let fontSize = this.getMinFontSize(context, element, boundingBoxWidth, style)
        let label = ""


        if (this.showClass && element.classLabel)
        {
            label = element.classLabel
            label = RenderBox.toTitleCase(label)
            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
        }

        if (this.showText && element.labels)
        {
            fontSize = this.getMinFontSize(context, element, boundingBoxWidth, style, true)
            for (let i = 0; i < element.labels.length; i++)
            {
                label = element.labels[ i ]?.label
                if (!label) continue

                yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, true, fontSize)
            }
        }

        if (this.showNestedClasses && element?.classes)
        {
            for (let i = 0; i < element.classes.length; i++)
            {
                label = element.classes[ i ]?.classLabel

                if (!label) continue

                label = RenderBox.toTitleCase(label)
                yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
            }
        }

        if (this.showTraceId && element.traceId)
        {
            label = 'Id' + element.traceId
            label = RenderBox.toTitleCase(label)
            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
        }

        if (this.showConfidence && element.confidence)
        {
            label = Math.round(element.confidence * 100) + '%'
            label = RenderBox.toTitleCase(label)
            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
        }
    }

    // Draw a label on the canvas, scaling the font size to fit the bounding box
    drawLabel(label: string, context: CanvasRenderingContext2D, element: any, yScale: number, xScale: number, yOffset: number, xOffset: number, style: Style, boundingBoxWidth: number, padding: number, scaleToBounds = false, fontSize?: number): number
    {
        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'top'

        // Set the original font size
        context.font = style.font

        // Measure the text with the original font size
        let textDetails = context.measureText(label)

        // Calculate the scale factor
        let scaleFactor = boundingBoxWidth / textDetails.width

        let fontType = style.font.split(' ')[ 1 ]
        if (fontSize)
        {
            context.font = `${fontSize}px ` + fontType
        } else
        {
            // We calculate the font size if it is not provided, 
            //   further scaling it up to the bounds of the rect if enabled
            let fontSize = parseInt(style.font.split(' ')[ 0 ])

            if (scaleToBounds)
            {
                fontSize *= scaleFactor
            } else
            {
                // Apply the scale factor to the font size, but limit the maximum size to the original font size
                fontSize = Math.min(fontSize, fontSize * scaleFactor)
            }
            context.font = `${fontSize}px ${fontType}`
        }

        // Measure the text again with the new font size
        textDetails = context.measureText(label)

        let xPos = element.x * xScale + xOffset + 1.5 * padding
        let yPos = element.y * yScale + yOffset + 1.5 * padding

        context.fillText(label, xPos, yPos)
        const boxSize = padding + textDetails.actualBoundingBoxAscent + textDetails.actualBoundingBoxDescent
        yPos += boxSize
        return padding + textDetails.actualBoundingBoxDescent
    }

    static toTitleCase(str: string)
    {
        if (!str) return ''
        return str.replace(/\w\S*/g, function (txt)
        {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        })
    }

    // Gets the largest label from all the labels to be displayed
    getMinFontSize(context: CanvasRenderingContext2D, element: any, width: number, style: any, scaleToWidth: boolean = false): number
    {
        let largestLabel = ''
        if (this.showText && element.labels)
        {
            for (let i = 0; i < element.labels.length; i++)
            {
                const label = element.labels[ i ].label

                if (!label) continue

                const formattedLabel = `${RenderBox.toTitleCase(label)}`
                if (formattedLabel.length > largestLabel.length)
                {
                    largestLabel = formattedLabel
                }
            }
        }

        if (this.showClass && element.classLabel)
        {
            const label = element.classLabel
            const formattedLabel = `${RenderBox.toTitleCase(label)}`
            if (formattedLabel.length > largestLabel.length)
            {
                largestLabel = formattedLabel
            }
        }

        if (this.showNestedClasses && element?.classes)
        {
            for (let i = 0; i < element.classes.length; i++)
            {
                const label = element.classes[ i ].classLabel
                const formattedLabel = `${RenderBox.toTitleCase(label)}`
                if (formattedLabel.length > largestLabel.length)
                {
                    largestLabel = formattedLabel
                }
            }
        }

        if (this.showTraceId && element.traceId)
        {
            const label = `ID: ${element.traceId}`
            const formattedLabel = `${RenderBox.toTitleCase(label)}`
            if (formattedLabel.length > largestLabel.length)
            {
                largestLabel = formattedLabel
            }
        }

        if (this.showConfidence && element.confidence)
        {
            const label = `${Math.round(element.confidence * 100)}%`
            const formattedLabel = `${RenderBox.toTitleCase(label)}`
            if (formattedLabel.length > largestLabel.length)
            {
                largestLabel = formattedLabel
            }
        }

        let fontSize = this.getFontSize(largestLabel, context, style, width, scaleToWidth)

        return fontSize
    }

    getFontSize(label: string, context: CanvasRenderingContext2D, style: Style, boundingBoxWidth: number, scaleToWidth: boolean = false): number
    {
        context.textAlign = 'left'
        context.textBaseline = 'top'

        // Set the original font size
        context.font = style.font

        // Measure the text with the original font size
        let textDetails = context.measureText(label)

        // Calculate the scale factor
        let scaleFactor = boundingBoxWidth / textDetails.width
        let fontSize = parseInt(style.font.split(' ')[ 0 ])

        if (scaleToWidth)
        {
            fontSize *= scaleFactor
        } else
        {
            fontSize = Math.min(fontSize, fontSize * scaleFactor)
        }

        return fontSize
    }

}
