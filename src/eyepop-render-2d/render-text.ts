import { PredictedObject, StreamTime } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { CanvasRenderingContext2D } from 'canvas'
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderTextOptions = {
    showText: boolean // Whether to show labels, such as OCR text
    fitToBounds: boolean // Whether to scale the font size to fit the bounding box
    textPadding?: number // Padding as percentage of container (0.0-1.0)
} & RenderTarget

export class RenderText implements Render {
    public target: string = DEFAULT_TARGET
    public fitToBounds: boolean = true
    public textPadding: number = 0.1

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    constructor(options: Partial<RenderTextOptions> = {}) {
        const { target = '$..objects[?(@.texts)]', fitToBounds = true, textPadding = 0.1 } = options
        this.target = target
        this.fitToBounds = fitToBounds
        this.textPadding = Math.max(0.02, Math.min(0.2, textPadding)) // Clamp between 2% and 20%
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {
        // Safety checks to prevent freezes
        if (!element || element.width <= 0 || element.height <= 0 || !element.texts || element.texts.length === 0) {
            return
        }

        const context = this.context
        const style = this.style
        if (!context || !style) {
            throw new Error('render() called before start()')
        }

        const w = element.width * xScale
        const h = element.height * yScale

        let canvasDimension = Math.min(context.canvas.width, context.canvas.height)

        let padding = canvasDimension * this.textPadding * style.cornerPadding
        padding = Math.min(padding, w * this.textPadding, h * this.textPadding)

        const boundingBoxWidth = w - padding * 2
        const boundingBoxHeight = h - padding * 2

        let fontSize = this.getMinFontSize(context, element, boundingBoxWidth, boundingBoxHeight, style, this.fitToBounds)
        let label = ''

        // Collect text metrics for centering
        const fontType = style.font.split(' ')[1]
        context.font = `${fontSize}px ${fontType}`

        // Calculate total text height for vertical centering
        let totalTextHeight = 0
        const textMetrics = []

        for (let i = 0; i < element.texts.length; i++) {
            label = element.texts[i]?.text || ''
            if (!label) continue

            const metrics = context.measureText(label)
            const lineHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
            totalTextHeight += lineHeight

            textMetrics.push({
                text: label,
                width: metrics.width,
                height: lineHeight,
            })
        }

        // Add spacing between lines
        const spacing = fontSize * 0.2
        if (element.texts.length > 1) {
            totalTextHeight += spacing * (element.texts.length - 1)
        }

        // Calculate vertical position for centering all text
        let textY = element.y * yScale + yOffset + (h - totalTextHeight) / 2

        // Now draw each line of text centered
        for (let i = 0; i < textMetrics.length; i++) {
            const metrics = textMetrics[i]

            // Center text horizontally
            let textX = element.x * xScale + xOffset + (w - metrics.width) / 2

            this.drawText(metrics.text, context, textX, textY, style, fontSize)

            // Move to next line
            textY += metrics.height + spacing
        }
    }

    // Draw a label on the canvas
    drawText(text: string, context: CanvasRenderingContext2D, xPos: number, yPos: number, style: Style, fontSize: number): void {
        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'top'

        // Set the font size
        let fontType = style.font.split(' ')[1]
        context.font = `${fontSize}px ${fontType}`

        // Draw the text
        context.fillText(text, xPos, yPos)
    }

    static toTitleCase(str: string) {
        if (!str) return ''
        return str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        })
    }

    // Gets the optimal font size for all labels to fit in the bounding box
    getMinFontSize(context: CanvasRenderingContext2D, element: any, width: number, height: number, style: any, scaleToFit: boolean = false): number {
        const textLines = (element.texts || []).map((t: any) => t?.text || '').filter((t: string) => t)
        const textCount = textLines.length
        if (textCount === 0) return parseInt(style.font.split(' ')[0])

        const baseFontSize = parseInt(style.font.split(' ')[0])
        if (!scaleToFit) {
            return baseFontSize
        }

        // Simple direct approach focused on performance
        try {
            const fontType = style.font.split(' ')[1]

            // For single line, calculate directly based on height and width constraints
            if (textCount === 1) {
                // Target 90% of height for single line to leave small padding
                const targetHeight = height * 0.9

                // Start with a height-based size and measure
                let fontSize = Math.floor(targetHeight)
                context.font = `${fontSize}px ${fontType}`
                const metrics = context.measureText(textLines[0])

                // If width exceeds container, scale down proportionally
                if (metrics.width > width) {
                    // Simple, direct calculation
                    fontSize = Math.floor(fontSize * (width / metrics.width) * 0.95)
                }

                return Math.max(5, fontSize)
            }

            // For multiple lines, allocate height based on line count
            // Faster approach - one direct calculation

            // Set aside 10% of height for spacing between lines
            const availableHeight = height * 0.9
            const lineSpacing = textCount > 1 ? (availableHeight * 0.1) / (textCount - 1) : 0

            // Calculate height per line
            const heightPerLine = (availableHeight - (textCount - 1) * lineSpacing) / textCount

            // Initial font size based on height per line
            let fontSize = Math.floor(heightPerLine)
            context.font = `${fontSize}px ${fontType}`

            // Find longest line at this font size
            let maxWidth = 0
            for (const line of textLines) {
                const lineWidth = context.measureText(line).width
                maxWidth = Math.max(maxWidth, lineWidth)
            }

            // Scale down if width constraint is exceeded
            if (maxWidth > width) {
                fontSize = Math.floor(fontSize * (width / maxWidth) * 0.95)
            }

            return Math.max(5, fontSize)
        } catch (error) {
            // Ultra-safe fallback that will never cause performance issues
            return Math.min(height / (textCount + 1), width / 10)
        }
    }
}
