import { PredictedObject, StreamTime, PredictedClass } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { Canvas, CanvasRenderingContext2D } from 'canvas'
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderClassesOptions = {
    showConfidence?: boolean // Whether to show confidence, such as "male 95%"
    showDottedOutline?: boolean // Whether to show a dotted outline around the object
    classProperties?: ClassificationProperties[] // Classes to disable rendering for
    labelSizePercentage?: number // The label size as a percentage of the image width
} & RenderTarget

export type ClassificationProperties = {
    color?: string
    disabled?: boolean
    disabledOpacity?: number
}

export class RenderClasses implements Render {
    public target: string = '$'

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    private showConfidence: boolean
    private labelSizePercentage: number

    private classProperties: { [classLabel: string]: ClassificationProperties } = {}

    constructor(options: Partial<RenderClassesOptions> = {}) {
        const { showConfidence = false, classProperties = {}, target = '$', labelSizePercentage = 0.05 } = options

        this.target = target
        this.showConfidence = showConfidence
        this.classProperties = classProperties
        this.labelSizePercentage = labelSizePercentage
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime, color?: string): void {
        const context = this.context
        const style = this.style

        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        const canvas = context?.canvas as HTMLCanvasElement | Canvas
        const width = canvas?.width ?? 640
        const height = canvas?.height ?? 480

        // Calculate sizes based on image dimensions
        const baseSize = Math.min(width, height) * this.labelSizePercentage
        const xPadding = baseSize * 0.3
        const yPadding = baseSize * 2.4
        const fontSize = baseSize * 1.3

        let yOff = height - yPadding
        let xOff = xPadding

        if (element.classes) {
            let labelHeight = 0

            // Find the maximum label height, to keep the label height consistent
            element.classes.forEach((cls: PredictedClass) => {
                let label = cls.classLabel
                style.font = `${fontSize}px serif`
                context.font = style.font

                const textDetails = context?.measureText(label)
                const currentLabelHeight = textDetails.actualBoundingBoxAscent + textDetails.actualBoundingBoxDescent + 2 * xPadding * 0.5
                labelHeight = Math.max(currentLabelHeight, labelHeight)
            })

            // Draw the labels
            element.classes.forEach((cls: PredictedClass) => {
                let label = cls.classLabel
                const properties = this.classProperties?.[cls.classLabel]

                const drawDisabled = properties?.disabled ?? false
                style.colors.primary_color = properties?.color ?? '#009dff'

                if (drawDisabled) {
                    context.globalAlpha = properties?.disabledOpacity ?? 0.5
                }

                if (this.showConfidence && cls.confidence) {
                    label += ` ${Math.round(cls.confidence * 100)}%`
                }

                const textDetails = context.measureText(label)
                const labelWidth = textDetails.width + 2 * xPadding * 0.5
                const borderRadius = labelHeight / 2

                this.drawLabel(label, context, xOff, yOff, style, drawDisabled, xPadding * 0.5, yPadding, labelWidth, labelHeight, borderRadius)

                xOff += labelWidth + xPadding

                const maxWidth = width * 0.9 - xPadding

                if (xOff + labelWidth > maxWidth) {
                    xOff = xPadding
                    yOff -= yPadding
                }
            })
        }
    }

    drawLabel(
        label: string,
        context: CanvasRenderingContext2D,
        xOffset: number,
        yOffset: number,
        style: Style,
        drawDisabled: boolean,
        xPadding: number,
        yPadding: number,
        labelWidth: number,
        labelHeight: number,
        borderRadius: number,
    ) {
        context.font = style.font
        context.fillStyle = style.colors.primary_color

        if (drawDisabled) {
            context.globalAlpha = 0.5
        } else {
            context.globalAlpha = 1
        }

        context.strokeStyle = '#ffffff'
        context.setLineDash([labelHeight / 10, labelHeight / 10])
        context.lineWidth = labelHeight / 20
        // Don't stroke yet - need to define the path first

        context.beginPath()
        context.moveTo(xOffset + borderRadius, yOffset - labelHeight / 2)
        context.lineTo(xOffset + labelWidth - borderRadius, yOffset - labelHeight / 2)
        context.quadraticCurveTo(xOffset + labelWidth, yOffset - labelHeight / 2, xOffset + labelWidth, yOffset - labelHeight / 2 + borderRadius)
        context.lineTo(xOffset + labelWidth, yOffset + labelHeight / 2 - borderRadius)
        context.quadraticCurveTo(xOffset + labelWidth, yOffset + labelHeight / 2, xOffset + labelWidth - borderRadius, yOffset + labelHeight / 2)
        context.lineTo(xOffset + borderRadius, yOffset + labelHeight / 2)
        context.quadraticCurveTo(xOffset, yOffset + labelHeight / 2, xOffset, yOffset + labelHeight / 2 - borderRadius)
        context.lineTo(xOffset, yOffset - labelHeight / 2 + borderRadius)
        context.quadraticCurveTo(xOffset, yOffset - labelHeight / 2, xOffset + borderRadius, yOffset - labelHeight / 2)
        context.closePath()
        context.fill()
        context.stroke() // Apply the stroke to the path

        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'middle'
        context.fillText(label, xOffset + xPadding, yOffset)
    }
}
