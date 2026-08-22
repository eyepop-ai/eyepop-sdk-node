import { describe, expect, test } from '@jest/globals'
import type { Prediction } from '../../src/eyepop'
import { decodeDepthMap } from '../../src/eyepop'

function encodeFloats(values: number[]): string {
    const buffer = new ArrayBuffer(values.length * 4)
    const view = new DataView(buffer)
    values.forEach((value, i) => view.setFloat32(i * 4, value, true))
    return Buffer.from(buffer).toString('base64')
}

describe('Depth prediction member', () => {
    // 4x2 map, row-major; one +Infinity sky pixel at (3, 0)
    const values = [1.5, 2.5, 3.5, Number.POSITIVE_INFINITY, 10.0, 20.0, 30.0, 40.0]
    const depth = { width: 4, height: 2, values: encodeFloats(values) }

    test('accepts a frame-level depth member', () => {
        const frame = {
            source_width: 1280,
            source_height: 640,
            depth,
        } satisfies Prediction

        expect(frame.depth?.width).toBe(4)
        expect(frame.depth?.height).toBe(2)
    })

    test('decodeDepthMap decodes little-endian float32 values', () => {
        const depthMap = decodeDepthMap(depth)

        expect(depthMap.width).toBe(4)
        expect(depthMap.height).toBe(2)
        expect(Array.from(depthMap.values)).toEqual(values)
    })

    test('sky pixels decode to positive infinity', () => {
        const depthMap = decodeDepthMap(depth)

        expect(depthMap.at(3, 0)).toBe(Number.POSITIVE_INFINITY)
        expect(depthMap.isSky(3, 0)).toBe(true)
        expect(depthMap.isSky(0, 0)).toBe(false)
    })

    test('finite range ignores sky pixels', () => {
        const depthMap = decodeDepthMap(depth)

        expect(depthMap.finiteMin).toBe(1.5)
        expect(depthMap.finiteMax).toBe(40.0)
    })

    test('at() maps source coordinates proportionally', () => {
        const depthMap = decodeDepthMap(depth)

        // source (0,0) -> map (0,0); source bottom-right -> map (3,1)
        expect(depthMap.at(0, 0, 1280, 640)).toBe(1.5)
        expect(depthMap.at(1279, 639, 1280, 640)).toBe(40.0)
        // out-of-bounds map coordinates clamp
        expect(depthMap.at(99, 99)).toBe(40.0)
    })

    test('rejects a truncated payload', () => {
        expect(() => decodeDepthMap({ width: 4, height: 2, values: encodeFloats([1, 2]) })).toThrow()
    })
})
