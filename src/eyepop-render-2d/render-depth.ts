import { Prediction, StreamTime } from '@eyepop.ai/eyepop'
import { Style } from './style'
import { CanvasRenderingContext2D } from 'canvas'
import { Render, RenderTarget } from './render'

export type RenderDepthOptions = {
    opacity?: number // overlay opacity over the underlying frame, 0..1 (default 0.5)
    renderSky?: boolean // also paint sky pixels (+Infinity); default leaves the frame untouched where the sky is
} & RenderTarget

// anchor colors of Google's turbo colormap, evenly spaced over [0, 1]
const TURBO_ANCHORS: [number, number, number][] = [
    [48, 18, 59],
    [62, 86, 196],
    [33, 145, 237],
    [26, 192, 181],
    [94, 223, 105],
    [181, 229, 54],
    [243, 192, 52],
    [246, 117, 26],
    [122, 4, 3],
]

const SKY_COLOR: [number, number, number] = [48, 18, 59]

const isLittleEndianPlatform = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

// runtime imports from @eyepop.ai/eyepop would pull the whole (node-flavored)
// core package into the browser bundle, so - like render-mask - this renderer
// decodes the wire format itself; Buffer is polyfilled by webpack.ProvidePlugin
function decodeDepthValues(base64: string, count: number): Float32Array {
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.byteLength !== count * 4) {
        throw new Error(`depth values hold ${buffer.byteLength} bytes, expected ${count * 4} float32 bytes`)
    }
    if (isLittleEndianPlatform) {
        // copy to a fresh, aligned buffer (Buffer pool slices can be unaligned)
        const aligned = new Uint8Array(buffer)
        return new Float32Array(aligned.buffer, 0, count)
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const values = new Float32Array(count)
    for (let i = 0; i < count; i++) {
        values[i] = view.getFloat32(i * 4, true)
    }
    return values
}

function turboColor(position: number): [number, number, number] {
    const scaled = Math.min(Math.max(position, 0), 1) * (TURBO_ANCHORS.length - 1)
    const lower = Math.floor(scaled)
    const upper = Math.min(lower + 1, TURBO_ANCHORS.length - 1)
    const fraction = scaled - lower
    return [
        TURBO_ANCHORS[lower][0] * (1 - fraction) + TURBO_ANCHORS[upper][0] * fraction,
        TURBO_ANCHORS[lower][1] * (1 - fraction) + TURBO_ANCHORS[upper][1] * fraction,
        TURBO_ANCHORS[lower][2] * (1 - fraction) + TURBO_ANCHORS[upper][2] * fraction,
    ]
}

/**
 * Renders a frame-level depth map (Prediction.depth) as a turbo-colormap
 * heatmap blended over the frame: near = warm (red/yellow), far = cool (blue).
 * Sky pixels (+Infinity) leave the frame untouched unless renderSky is set.
 *
 * Uses getImageData/putImageData only, so it works with node-canvas as well
 * as browser and react-native canvases.
 */
export class RenderDepth implements Render {
    public target: string = '$'

    private context: CanvasRenderingContext2D | undefined
    private style: Style | undefined

    private readonly opacity: number
    private readonly renderSky: boolean

    constructor(options: Partial<RenderDepthOptions> = {}) {
        const { target = '$', opacity = 0.5, renderSky = false } = options
        this.target = target
        this.opacity = Math.min(Math.max(opacity, 0), 1)
        this.renderSky = renderSky
    }

    start(context: CanvasRenderingContext2D, style: Style) {
        this.context = context
        this.style = style
    }

    public draw(element: Prediction, xOffset: number, yOffset: number, xScale: number, yScale: number, streamTime: StreamTime, color?: string): void {
        const context = this.context
        if (!context || !this.style) {
            throw new Error('render() called before start()')
        }
        if (!element.depth) {
            return
        }
        const depthWidth = element.depth.width
        const depthHeight = element.depth.height
        const values = decodeDepthValues(element.depth.values, depthWidth * depthHeight)
        const destWidth = Math.round(element.source_width * xScale)
        const destHeight = Math.round(element.source_height * yScale)
        if (destWidth <= 0 || destHeight <= 0) {
            return
        }

        let finiteMin = Number.POSITIVE_INFINITY
        let finiteMax = Number.NEGATIVE_INFINITY
        for (let i = 0; i < values.length; i++) {
            const value = values[i]
            if (Number.isFinite(value)) {
                if (value < finiteMin) finiteMin = value
                if (value > finiteMax) finiteMax = value
            }
        }
        const span = finiteMax > finiteMin ? finiteMax - finiteMin : 1.0

        const dest = context.getImageData(xOffset, yOffset, destWidth, destHeight)
        const pixels = dest.data
        for (let y = 0; y < destHeight; y++) {
            const mapY = Math.min(Math.floor((y * depthHeight) / destHeight), depthHeight - 1)
            const mapRow = mapY * depthWidth
            for (let x = 0; x < destWidth; x++) {
                const mapX = Math.min(Math.floor((x * depthWidth) / destWidth), depthWidth - 1)
                const value = values[mapRow + mapX]
                let heat: [number, number, number]
                if (Number.isFinite(value)) {
                    // near = warm end of turbo, far = cool end
                    const normalized = Number.isFinite(finiteMin) ? (value - finiteMin) / span : 0
                    heat = turboColor(1 - normalized)
                } else if (this.renderSky) {
                    heat = SKY_COLOR
                } else {
                    continue
                }
                const index = (y * destWidth + x) * 4
                pixels[index] = Math.round(heat[0] * this.opacity + pixels[index] * (1 - this.opacity))
                pixels[index + 1] = Math.round(heat[1] * this.opacity + pixels[index + 1] * (1 - this.opacity))
                pixels[index + 2] = Math.round(heat[2] * this.opacity + pixels[index + 2] * (1 - this.opacity))
                pixels[index + 3] = 255
            }
        }
        context.putImageData(dest, xOffset, yOffset)
    }
}
