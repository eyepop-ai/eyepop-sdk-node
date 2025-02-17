import { PredictedObject, StreamTime, PredictedClass } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { CanvasRenderingContext2D } from 'canvas'
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderClassesOptions = {
    showConfidence?: boolean // Whether to show confidence, such as "male 95%"
    showDottedOutline?: boolean // Whether to show a dotted outline around the object
    classProperties?: ClassificationProperties[] // Classes to disable rendering for
} & RenderTarget

export type ClassificationProperties = {
    classLabel: string

    color?: string
    disabled?: boolean
    disabledOpacity?: number
}

export class RenderClasses implements Render {
    public target: string = '$'

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    private showConfidence: boolean

    private classProperties: ClassificationProperties[] = []

    constructor(options: Partial<RenderClassesOptions> = {}) {
        const { showConfidence = true, classProperties = [], target = '$' } = options

        this.target = target
        this.showConfidence = showConfidence
        this.classProperties = classProperties
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

        let yOff = context.canvas.height - 20
        let xOff = 10

        if (element.classes) {
            element.classes.forEach((cls: PredictedClass) => {
                const properties = this.classProperties.find((prop: ClassificationProperties) => {
                    return prop.classLabel === cls.classLabel
                })

                const drawDisabled = properties?.disabled ?? false
                style.colors.primary_color = properties?.color ?? '#009dff'

                let label = cls.classLabel
                if (drawDisabled) {
                    context.globalAlpha = properties?.disabledOpacity ?? 0.5
                }

                if (this.showConfidence && cls.confidence) {
                    label += ` ${Math.round(cls.confidence * 100)}%`
                }

                const labelWidth = this.drawLabel(label, context, xOff, yOff, style, drawDisabled)

                xOff += labelWidth + 10

                if (xOff + labelWidth > context.canvas.width * 0.95) {
                    xOff = 10
                    yOff -= 30
                }
            })
        }
    }
    drawLabel(label: string, context: CanvasRenderingContext2D, xOffset: number, yOffset: number, style: Style, drawDisabled: boolean): number {
        context.font = style.font
        const textDetails = context.measureText(label)
        const padding = 5
        const labelWidth = textDetails.width + 2 * padding
        const labelHeight = textDetails.actualBoundingBoxAscent + textDetails.actualBoundingBoxDescent + 2 * padding
        const borderRadius = labelHeight / 2

        context.fillStyle = style.colors.primary_color

        if (drawDisabled) {
            context.globalAlpha = 0.5
            context.strokeStyle = '#ffffff'
            context.setLineDash([5, 3])
            context.stroke()
            context.setLineDash([])
        } else {
            context.globalAlpha = 1
        }

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

        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'middle'
        context.fillText(label, xOffset + padding, yOffset)

        return labelWidth
    }
}
