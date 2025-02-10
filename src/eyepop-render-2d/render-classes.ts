import { PredictedObject, StreamTime, PredictedClass } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { CanvasRenderingContext2D } from 'canvas'
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderClassesOptions = {
    showNestedClasses?: boolean // Whether to show nested classes, such as "person" + "necklace"
    showConfidence?: boolean // Whether to show confidence, such as "0.95"
} & RenderTarget

export class RenderClasses implements Render {
    public target: string = '$'

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined
    private showNestedClasses: boolean
    private showConfidence: boolean

    constructor(options: Partial<RenderClassesOptions> = {}) {
        const { showConfidence = false, showNestedClasses = false, target = '$' } = options

        this.target = target
        this.showNestedClasses = showNestedClasses
        this.showConfidence = showConfidence
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
                let label = cls.classLabel
                if (this.showConfidence && cls.confidence) {
                    label += ` ${Math.round(cls.confidence * 100)}%`
                }
                const labelWidth = this.drawLabel(label, context, xOff, yOff, style)

                xOff += labelWidth + 10

                if (xOff + labelWidth > context.canvas.width * 0.95) {
                    xOff = 10
                    yOff -= 30
                }
            })
        }
    }
    drawLabel(label: string, context: CanvasRenderingContext2D, xOffset: number, yOffset: number, style: Style): number {
        context.font = style.font
        const textDetails = context.measureText(label)
        const padding = 5
        const labelWidth = textDetails.width + 2 * padding
        const labelHeight = textDetails.actualBoundingBoxAscent + textDetails.actualBoundingBoxDescent + 2 * padding

        context.fillStyle = '#009dff'

        context.beginPath()
        context.fillRect(xOffset, yOffset - labelHeight / 2, labelWidth, labelHeight)
        context.closePath()

        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'middle'
        context.fillText(label, xOffset + padding, yOffset)

        return labelWidth
    }
}
