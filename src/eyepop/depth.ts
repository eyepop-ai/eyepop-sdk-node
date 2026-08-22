import { Depth } from './types'

const isLittleEndianPlatform = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

function base64ToBytes(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        const buffer = Buffer.from(base64, 'base64')
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

/**
 * A decoded frame-level depth map.
 *
 * Values are canonical metric depth in row-major order; sky pixels are +Infinity.
 * See decodeDepthMap().
 */
export class DepthMap {
    readonly width: number
    readonly height: number
    readonly values: Float32Array

    private _finiteMin: number | undefined
    private _finiteMax: number | undefined

    constructor(width: number, height: number, values: Float32Array) {
        this.width = width
        this.height = height
        this.values = values
    }

    /**
     * The depth value at map pixel (x, y), or - when sourceWidth/sourceHeight
     * are given - at source frame coordinate (x, y) mapped proportionally.
     * Returns +Infinity for sky pixels.
     */
    public at(x: number, y: number, sourceWidth?: number, sourceHeight?: number): number {
        let mapX = x
        let mapY = y
        if (sourceWidth && sourceHeight) {
            mapX = (x * this.width) / sourceWidth
            mapY = (y * this.height) / sourceHeight
        }
        const clampedX = Math.min(Math.max(Math.floor(mapX), 0), this.width - 1)
        const clampedY = Math.min(Math.max(Math.floor(mapY), 0), this.height - 1)
        return this.values[clampedY * this.width + clampedX]
    }

    public isSky(x: number, y: number, sourceWidth?: number, sourceHeight?: number): boolean {
        return this.at(x, y, sourceWidth, sourceHeight) === Number.POSITIVE_INFINITY
    }

    /** The smallest finite depth value, or undefined if the whole map is sky. */
    public get finiteMin(): number | undefined {
        this.computeFiniteRange()
        return this._finiteMin
    }

    /** The largest finite depth value, or undefined if the whole map is sky. */
    public get finiteMax(): number | undefined {
        this.computeFiniteRange()
        return this._finiteMax
    }

    private computeFiniteRange(): void {
        if (this._finiteMin !== undefined || this._finiteMax !== undefined) {
            return
        }
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        for (let i = 0; i < this.values.length; i++) {
            const value = this.values[i]
            if (Number.isFinite(value)) {
                if (value < min) min = value
                if (value > max) max = value
            }
        }
        if (max >= min) {
            this._finiteMin = min
            this._finiteMax = max
        }
    }
}

/**
 * Decode a Prediction's `depth` member into a DepthMap.
 *
 * The wire format is base64 of width*height little-endian float32 values in
 * row-major order; sky pixels are +Infinity.
 */
export function decodeDepthMap(depth: Depth): DepthMap {
    const bytes = base64ToBytes(depth.values)
    const count = depth.width * depth.height
    if (bytes.byteLength !== count * 4) {
        throw new Error(`depth values hold ${bytes.byteLength} bytes, expected ${count * 4} for ${depth.width}x${depth.height} float32`)
    }
    let values: Float32Array
    if (isLittleEndianPlatform) {
        // copy to a fresh, aligned buffer (e.g. Buffer pool slices can be unaligned)
        const aligned = new Uint8Array(bytes)
        values = new Float32Array(aligned.buffer, 0, count)
    } else {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        values = new Float32Array(count)
        for (let i = 0; i < count; i++) {
            values[i] = view.getFloat32(i * 4, true)
        }
    }
    return new DepthMap(depth.width, depth.height, values)
}
