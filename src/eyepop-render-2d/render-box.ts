import { PredictedObject, StreamTime, PredictedClass } from "@eyepop.ai/eyepop"
import { Style } from "./style"
import { CanvasRenderingContext2D } from "canvas"
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export enum BoxType
{
    Rich = "rich",
    Simple = "simple",
    SimpleSelected = "simpleSelected"
}

export type RenderBoxOptions = {
    showClass?: boolean // Whether to show class labels, such as "person"
    showNestedClasses?: boolean // Whether to show nested classes, such as "person" + "necklace"
    showConfidence?: boolean // Whether to show confidence, such as "0.95"
    showTraceId?: boolean // Whether to show trace ID, such as "132"
    boxType?: BoxType // The style of the box bounds
} & RenderTarget

export class RenderBox implements Render
{
    public target: string = DEFAULT_TARGET

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined
    private showClass: boolean
    private showNestedClasses: boolean
    private showConfidence: boolean
    private showTraceId: boolean
    private boxType?: BoxType

    constructor(options: Partial<RenderBoxOptions> = {})
    {
        const { showClass = true, showConfidence = false, showTraceId = false, showNestedClasses = false, target = '$..objects.*', boxType = BoxType.Rich } = options

        this.target = target
        this.showClass = showClass
        this.showNestedClasses = showNestedClasses
        this.showConfidence = showConfidence
        this.showTraceId = showTraceId
        this.boxType = boxType
    }

    start(context: CanvasRenderingContext2D, style: Style)
    {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime, color?: string): void
    {
        if (this.boxType === BoxType.Simple)
        {
            this.drawSimple(element, xOffset, yOffset, xScale, yScale, streamTime, color)
            return;
        } else if (this.boxType === BoxType.SimpleSelected)
        {
            this.drawSimpleSelected(element, xOffset, yOffset, xScale, yScale, streamTime, color)
            return;
        }

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

        // Sort the element's objects based on the element.object.category
        if (element.objects)
        {
            element.objects.sort((a, b) =>
            {
                if (!a.category || !b.category) return 0

                return a.category.localeCompare(b.category)
            })
        }

        let canvasDimension = Math.min(w, h);

        const lineWidth = Math.max(canvasDimension * .0025, style.scale)

        //faded blue background
        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = lineWidth
        context.strokeStyle = style.colors.opacity_color
        context.fillStyle = style.colors.opacity_color
        context.fill()
        context.stroke()

        let cornerSize = canvasDimension * style.cornerWidth
        cornerSize = Math.max(cornerSize, style.scale * 20)
        cornerSize = Math.min(cornerSize, canvasDimension / 2)
        let corners = this.createCornerPoints(x, y, w, h, cornerSize, style.scale)

        corners.forEach((corner) =>
        {
            context.beginPath()
            context.moveTo(corner[ 0 ].x, corner[ 0 ].y)
            context.lineTo(corner[ 1 ].x, corner[ 1 ].y)
            context.lineTo(corner[ 2 ].x, corner[ 2 ].y)
            context.strokeStyle = style.colors.primary_color
            context.lineWidth = lineWidth
            context.stroke()
        })

        let padding = canvasDimension * style.cornerPadding
        padding = Math.max(padding, style.scale * 4)

        cornerSize = cornerSize - (padding * 1.33)

        const corners2 = this.createCornerPoints(x, y, w, h, cornerSize, padding, padding / 2)

        corners2.forEach((corner) =>
        {
            context.beginPath()
            context.moveTo(corner[ 0 ].x, corner[ 0 ].y)
            context.lineTo(corner[ 1 ].x, corner[ 1 ].y)
            context.lineTo(corner[ 2 ].x, corner[ 2 ].y)
            context.strokeStyle = style.colors.secondary_color
            context.lineWidth = lineWidth
            context.stroke()
        })

        let boundingBoxWidth = (element.width * xScale) - (2 * padding);
        let boundingBoxHeight = (element.height * yScale) - (2 * padding);
        boundingBoxHeight = Math.max(boundingBoxHeight, 0)
        boundingBoxWidth = Math.max(boundingBoxWidth, 0)

        let fontSize = this.getMinFontSize(context, element, boundingBoxWidth, boundingBoxHeight, style)
        let label = ""

        if (this.showClass && element.classLabel)
        {
            label = element.classLabel
            label = RenderBox.toTitleCase(label)
            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
        }

        if (this.showNestedClasses && element?.classes)
        {
            // Sort the classes based category
            element.classes.sort((a: any, b: any) =>
            {
                return a.category.localeCompare(b.category)
            });


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
            label = 'ID: ' + element.traceId
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

    public drawSimple(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime, color?: string): void
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

        // Sort the element's objects based on the element.object.category
        if (element.objects)
        {
            element.objects.sort((a, b) =>
            {
                if (!a.category || !b.category) return 0

                return a.category.localeCompare(b.category)
            })
        }
        const scale = style.scale

        //faded blue background
        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = scale
        context.strokeStyle = color || style.colors.primary_color
        context.stroke()


        let canvasDimension = Math.min(context.canvas.width, context.canvas.height);

        let padding = Math.max(Math.min(w / 25, canvasDimension * (style.cornerWidth)), scale)

        let boundingBoxWidth = (element.width * xScale) - (3 * padding);
        let boundingBoxHeight = (element.height * yScale) - (3 * padding);

        boundingBoxHeight = Math.max(boundingBoxHeight, 0)
        boundingBoxWidth = Math.max(boundingBoxWidth, 0)

        let fontSize = this.getMinFontSize(context, element, boundingBoxWidth, boundingBoxHeight, style)
        let label = ""

        if (this.showClass && element.classLabel)
        {
            label = element.classLabel
            label = RenderBox.toTitleCase(label)
            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
        }

        if (this.showNestedClasses && element?.classes)
        {
            // Sort the classes based category
            element.classes.sort((a: any, b: any) =>
            {
                return a.category.localeCompare(b.category)
            });

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
            label = 'ID: ' + element.traceId
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

    public drawSimpleSelected(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime, color?: string): void
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

        // Sort the element's objects based on the element.object.category
        if (element.objects)
        {
            element.objects.sort((a, b) =>
            {
                if (!a.category || !b.category) return 0

                return a.category.localeCompare(b.category)
            })
        }
        const scale = style.scale

        //faded blue background
        context.beginPath()
        context.rect(x, y, w, h)
        context.lineWidth = scale
        context.strokeStyle = color || style.colors.primary_color
        //context.fillStyle = style.colors.opacity_color
        //context.fill()
        context.stroke()


        const desiredPercentage = 0.005;

        let canvasDimension = Math.min(context.canvas.width, context.canvas.height);

        // Draw the corners as circles at each corner of the bounding box
        let cornerSize = canvasDimension * desiredPercentage;

        let padding = Math.max(Math.min(w / 25, canvasDimension * (style.cornerWidth)), scale)

        let corners = this.createCornerPoints(x, y, w, h, cornerSize, padding)

        corners.forEach((corner: any) =>
        {
            context.beginPath();
            context.arc(corner.x, corner.y, cornerSize, 0, 2 * Math.PI);
            context.lineWidth = scale;
            context.strokeStyle = color || style.colors.primary_color;
            context.fillStyle = 'white' || style.colors.primary_color;
            context.fill();
            context.stroke();
        });

        let boundingBoxWidth = (element.width * xScale) - (3 * padding);
        let boundingBoxHeight = (element.height * yScale) - (3 * padding);

        boundingBoxHeight = Math.max(boundingBoxHeight, 0)
        boundingBoxWidth = Math.max(boundingBoxWidth, 0)

        let fontSize = this.getMinFontSize(context, element, boundingBoxWidth, boundingBoxHeight, style)
        let label = ""

        if (this.showClass && element.classLabel)
        {
            label = element.classLabel
            label = RenderBox.toTitleCase(label)
            yOffset += this.drawLabel(label, context, element, yScale, xScale, yOffset, xOffset, style, boundingBoxWidth, padding, false, fontSize)
        }

        if (this.showNestedClasses && element?.classes)
        {
            // Sort the classes based category
            element.classes.sort((a: any, b: any) =>
            {
                return a.category.localeCompare(b.category)
            });

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
            label = 'ID: ' + element.traceId
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

    createCornerPoints(x: number, y: number, w: number, h: number, cornerSize: number, padding: number = 1, insetPadding: number = 1): Array<Array<{ x: number, y: number }>>
    {
        const adjustedX = x + padding;
        const adjustedY = y + padding;
        const adjustedW = w - 2 * padding;
        const adjustedH = h - 2 * padding;

        const innerCornerSize = cornerSize - (insetPadding);

        return [
            // Top left corner
            [
                // Inner top left corner
                { x: adjustedX + insetPadding, y: adjustedY + innerCornerSize },
                { x: adjustedX + insetPadding, y: adjustedY + insetPadding },
                { x: adjustedX + innerCornerSize, y: adjustedY + insetPadding },
            ],
            // Bottom left corner
            [
                // Inner bottom left corner
                { x: adjustedX + insetPadding, y: adjustedY + adjustedH - innerCornerSize - insetPadding },
                { x: adjustedX + insetPadding, y: adjustedY + adjustedH - insetPadding },
                { x: adjustedX + innerCornerSize, y: adjustedY + adjustedH - insetPadding },
            ],
            // Top right corner
            [
                // Inner top right corner
                { x: adjustedX + adjustedW - innerCornerSize - insetPadding, y: adjustedY + insetPadding },
                { x: adjustedX + adjustedW - insetPadding, y: adjustedY + insetPadding },
                { x: adjustedX + adjustedW - insetPadding, y: adjustedY + innerCornerSize },
            ],
            // Bottom right corner
            [
                // Inner bottom right corner
                { x: adjustedX + adjustedW - innerCornerSize - insetPadding, y: adjustedY + adjustedH - insetPadding },
                { x: adjustedX + adjustedW - insetPadding, y: adjustedY + adjustedH - insetPadding },
                { x: adjustedX + adjustedW - insetPadding, y: adjustedY + adjustedH - innerCornerSize - insetPadding },
            ],
        ];
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
    getMinFontSize(context: CanvasRenderingContext2D, element: any, width: number, height: number, style: any, scaleToWidth: boolean = false): number
    {
        let largestLabel = ''

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

        let fontSize = this.getFontSize(largestLabel, context, style, width, height, scaleToWidth)

        return fontSize
    }

    getFontSize(label: string, context: CanvasRenderingContext2D, style: Style, boundingBoxWidth: number, boundingBoxHeight: number, scaleToWidth: boolean = false): number
    {
        context.textAlign = 'left'
        context.textBaseline = 'top'

        // Set the original font size
        context.font = style.font

        // Measure the text with the original font size
        let textDetails = context.measureText(label)

        // Calculate the scale factor
        let scaleFactor = boundingBoxWidth / (textDetails.actualBoundingBoxLeft + textDetails.actualBoundingBoxRight)

        // make sure the text fits in the height as well
        let fontSize = parseInt(style.font.split(' ')[ 0 ])

        if (scaleToWidth)
        {
            fontSize *= scaleFactor
        } else
        {
            fontSize = Math.min(fontSize, fontSize * scaleFactor)
        }

        fontSize = Math.max(fontSize, 0)

        return fontSize
    }

}
