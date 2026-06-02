import { PredictedObject, StreamTime } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { CanvasRenderingContext2D } from 'canvas'
import { Render, DEFAULT_TARGET, RenderTarget } from './render'

export type RenderTextOptions = {
    showText: boolean // Whether to show labels, such as OCR text
    fitToBounds: boolean // Whether to scale the font size to fit the bounding box
    textPadding?: number // Padding as percentage of container (0.0-1.0)
    maxLines?: number // Max lines to render before truncating with "..." (0 = unlimited)
} & RenderTarget

export class RenderText implements Render {
    public target: string = DEFAULT_TARGET
    public fitToBounds: boolean = true
    public textPadding: number = 0.1
    public maxLines: number = 12

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    constructor(options: Partial<RenderTextOptions> = {}) {
        const { target = '$..objects[?(@.texts)]', fitToBounds = true, textPadding = 0.1, maxLines = 12 } = options
        this.target = target
        this.fitToBounds = fitToBounds
        this.textPadding = Math.max(0.02, Math.min(0.2, textPadding))
        this.maxLines = maxLines
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public draw(element: PredictedObject, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime): void {
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

        const baseFontSize = parseInt(style.font.split(' ')[0])
        const fontType = style.font.split(' ')[1]

        // Collect all raw text entries, respecting embedded newlines
        const rawLines: string[] = []
        for (const entry of element.texts) {
            const text = entry?.text || ''
            if (!text) continue
            rawLines.push(...text.split('\n'))
        }

        if (rawLines.length === 0) return

        // Determine font size: for short single-line text use fitToBounds logic,
        // otherwise use baseFontSize so long descriptions stay readable
        const isShortSingleLine = rawLines.length === 1 && rawLines[0].length <= 60
        let fontSize: number

        if (this.fitToBounds && isShortSingleLine) {
            fontSize = this.getMinFontSize(context, element, boundingBoxWidth, boundingBoxHeight, style, true)
        } else {
            // For multi-line or long text, start from baseFontSize and scale down only if needed
            fontSize = baseFontSize
            if (this.fitToBounds) {
                // Cap at something that fits the box height reasonably
                const maxFontFromHeight = Math.floor(boundingBoxHeight * 0.12)
                fontSize = Math.min(fontSize, Math.max(maxFontFromHeight, 10))
            }
        }

        context.font = `${fontSize}px ${fontType}`

        // Word-wrap all lines to fit boundingBoxWidth
        const wrappedLines: string[] = []
        for (const line of rawLines) {
            const wrapped = this.wrapLine(context, line, boundingBoxWidth)
            wrappedLines.push(...wrapped)
        }

        // Truncate if over maxLines
        let displayLines = wrappedLines
        const truncated = this.maxLines > 0 && wrappedLines.length > this.maxLines
        if (truncated) {
            displayLines = wrappedLines.slice(0, this.maxLines)
            // Append ellipsis to last line
            const last = displayLines[displayLines.length - 1]
            displayLines[displayLines.length - 1] = last.replace(/\s+\S*$/, '') + '…'
        }

        // If wrapped lines still don't fit height-wise, scale font down
        const spacing = fontSize * 0.2
        const totalTextHeight = displayLines.length * fontSize + (displayLines.length - 1) * spacing
        if (totalTextHeight > boundingBoxHeight && displayLines.length > 0) {
            const scaleFactor = boundingBoxHeight / totalTextHeight
            fontSize = Math.max(8, Math.floor(fontSize * scaleFactor))
            context.font = `${fontSize}px ${fontType}`
        }

        const finalSpacing = fontSize * 0.2
        const finalLineHeight = fontSize + finalSpacing

        // Measure final total height for vertical centering
        const finalTotalHeight = displayLines.length * finalLineHeight - finalSpacing
        let textY = element.y * yScale + yOffset + (h - finalTotalHeight) / 2

        const textX = element.x * xScale + xOffset + padding
        for (const line of displayLines) {
            this.drawText(line, context, textX, textY, style, fontSize)
            textY += finalLineHeight
        }
    }

    private wrapLine(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        if (!text) return ['']
        if (context.measureText(text).width <= maxWidth) return [text]

        const words = text.split(' ')
        const lines: string[] = []
        let current = ''

        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word
            if (context.measureText(candidate).width > maxWidth && current) {
                lines.push(current)
                current = word
            } else {
                current = candidate
            }
        }
        if (current) lines.push(current)
        return lines.length > 0 ? lines : [text]
    }

    drawText(text: string, context: CanvasRenderingContext2D, xPos: number, yPos: number, style: Style, fontSize: number): void {
        context.fillStyle = '#ffffff'
        context.textAlign = 'left'
        context.textBaseline = 'top'

        let fontType = style.font.split(' ')[1]
        context.font = `${fontSize}px ${fontType}`

        context.fillText(text, xPos, yPos)
    }

    static toTitleCase(str: string) {
        if (!str) return ''
        return str.replace(/\w\S*/g, function (txt) {
            return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
        })
    }

    getMinFontSize(context: CanvasRenderingContext2D, element: any, width: number, height: number, style: any, scaleToFit: boolean = false): number {
        const textLines = (element.texts || []).map((t: any) => t?.text || '').filter((t: string) => t)
        const textCount = textLines.length
        if (textCount === 0) return parseInt(style.font.split(' ')[0])

        const baseFontSize = parseInt(style.font.split(' ')[0])
        if (!scaleToFit) {
            return baseFontSize
        }

        try {
            const fontType = style.font.split(' ')[1]

            if (textCount === 1) {
                const targetHeight = height * 0.9
                let fontSize = Math.floor(targetHeight)
                context.font = `${fontSize}px ${fontType}`
                const metrics = context.measureText(textLines[0])

                if (metrics.width > width) {
                    fontSize = Math.floor(fontSize * (width / metrics.width) * 0.95)
                }

                return Math.max(5, fontSize)
            }

            const availableHeight = height * 0.9
            const lineSpacing = textCount > 1 ? (availableHeight * 0.1) / (textCount - 1) : 0
            const heightPerLine = (availableHeight - (textCount - 1) * lineSpacing) / textCount

            let fontSize = Math.floor(heightPerLine)
            context.font = `${fontSize}px ${fontType}`

            let maxWidth = 0
            for (const line of textLines) {
                const lineWidth = context.measureText(line).width
                maxWidth = Math.max(maxWidth, lineWidth)
            }

            if (maxWidth > width) {
                fontSize = Math.floor(fontSize * (width / maxWidth) * 0.95)
            }

            return Math.max(5, fontSize)
        } catch (error) {
            return Math.min(height / (textCount + 1), width / 10)
        }
    }
}
