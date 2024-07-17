import { PredictedObject, StreamTime } from "@eyepop.ai/eyepop"
import { Style } from "./style"
import { CanvasRenderingContext2D } from "canvas"
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderTextOptions = {
    showText: boolean // Whether to show labels, such as OCR text
    fitToBounds: boolean // Whether to scale the font size to fit the bounding box
} & RenderTarget

export class RenderText implements Render
{
    public target: string = DEFAULT_TARGET
    public fitToBounds: boolean = true

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    constructor(options: Partial<RenderTextOptions> = {})
    {
        const { target = '$..objects[?(@.classLabel=="text")]', fitToBounds = true } = options
        this.target = target
        this.fitToBounds = fitToBounds
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

        const scale = style.scale
        const w = element.width * xScale

        let canvasDimension = Math.min(context.canvas.width, context.canvas.height);

        const padding = Math.max(Math.min(w / 25, canvasDimension * (style.cornerWidth)), scale * 2)
        const boundingBoxWidth = (element.width * xScale) - (3 * padding);

        if (!element.labels) return

        let fontSize = this.getMinFontSize(context, element, boundingBoxWidth, style, true)
        let label = ""

        for (let i = 0; i < element.labels.length; i++)
        {
            label = element.labels[ i ]?.label
            if (!label) continue

            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, this.fitToBounds, fontSize)
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
        for (let i = 0; i < element.labels.length; i++)
        {
            const label = element.labels[ i ].label

            if (!label) continue

            if (label.length > largestLabel.length)
            {
                largestLabel = label
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
