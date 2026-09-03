import { describe, expect, test } from '@jest/globals'
import type { Depth, Mask, Prediction } from '../../src/eyepop'
import { cloudOfDepth, cloudOfObject, cloudsOfPrediction, decodePointCloud } from '../../src/eyepop'

function encodeFloats(values: number[]): string {
    const buffer = new ArrayBuffer(values.length * 4)
    const view = new DataView(buffer)
    values.forEach((value, i) => view.setFloat32(i * 4, value, true))
    return Buffer.from(buffer).toString('base64')
}

// A 2x2 cloud: three placed points and one the worker could not place, which
// the wire marks with NaN rather than omitting.
const CLOUD = encodeFloats([
    1,
    2,
    3, // (0, 0)
    4,
    5,
    6, // (1, 0)
    NaN,
    NaN,
    NaN, // (0, 1) - sky, out of map, or not covered by the mask
    7,
    8,
    9, // (1, 1)
])

function mask(): Mask {
    return { bitmap: '', width: 2, height: 2, stride: 2, world: CLOUD }
}

function depth(overrides: Partial<Depth> = {}): Depth {
    return { width: 2, height: 2, values: '', semantic: 'metric', world: CLOUD, ...overrides }
}

describe('world coordinates on points', () => {
    test('a point carries them when the pipeline was asked for them', () => {
        const prediction: Prediction = {
            source_width: 640,
            source_height: 480,
            objects: [{ classLabel: 'person', x: 0, y: 0, width: 2, height: 2, outline: [{ x: 1, y: 2, worldX: 1.5, worldY: -2.25, worldZ: 8 }] }],
        } as Prediction
        expect(prediction.objects?.[0].outline?.[0].worldZ).toBe(8)
    })

    test('a point the worker could not place carries none of the three', () => {
        const point = { x: 1, y: 2 }
        expect(point).not.toHaveProperty('worldX')
    })
})

describe('mask point cloud', () => {
    test('decodes on the bitmap grid, with omitted points undefined', () => {
        const cloud = decodePointCloud(mask())
        expect(cloud).toBeDefined()
        expect([cloud!.width, cloud!.height]).toEqual([2, 2])
        expect(cloud!.at(0, 0)).toEqual({ x: 1, y: 2, z: 3 })
        expect(cloud!.at(0, 1)).toBeUndefined()
        expect(cloud!.isPlaced(1, 1)).toBe(true)
    })

    test('NaN survives decoding rather than being rejected', () => {
        // the depth decoder rejects a malformed payload; here NaN is the
        // contract's omission sentinel and must be preserved
        const cloud = decodePointCloud(mask())
        expect(Number.isNaN(cloud!.points[6])).toBe(true)
    })

    test('a mask without a cloud yields none', () => {
        expect(decodePointCloud({ bitmap: '', width: 2, height: 2, stride: 2 })).toBeUndefined()
        expect(decodePointCloud(undefined)).toBeUndefined()
    })

    test('a payload of the wrong length is rejected', () => {
        expect(() => decodePointCloud({ bitmap: '', width: 4, height: 4, stride: 4, world: CLOUD })).toThrow()
    })

    test('placed points drop the holes, and bounds are per axis', () => {
        const cloud = decodePointCloud(mask())!
        expect(cloud.placedPoints).toHaveLength(3)
        expect(cloud.bounds).toEqual({ min: { x: 1, y: 2, z: 3 }, max: { x: 7, y: 8, z: 9 } })
    })

    test('an entirely unplaced cloud has no bounds', () => {
        const empty = encodeFloats([NaN, NaN, NaN])
        const cloud = decodePointCloud({ bitmap: '', width: 1, height: 1, stride: 1, world: empty })!
        expect(cloud.placedPoints).toHaveLength(0)
        expect(cloud.bounds).toBeUndefined()
    })

    test("an object's cloud maps source coordinates through its box", () => {
        const cloud = cloudOfObject({ classLabel: 'car', x: 100, y: 200, width: 40, height: 40, mask: mask() } as any)!
        expect(cloud.atSource(105, 205)).toEqual({ x: 1, y: 2, z: 3 })
        expect(cloud.atSource(135, 235)).toEqual({ x: 7, y: 8, z: 9 })
    })

    test('a bare mask cloud cannot map source coordinates', () => {
        expect(() => decodePointCloud(mask())!.atSource(1, 1)).toThrow()
    })

    test('an index outside the grid is rejected', () => {
        expect(() => decodePointCloud(mask())!.at(2, 0)).toThrow()
    })
})

describe('scene point cloud', () => {
    test("decodes on the depth map's own grid", () => {
        const cloud = cloudOfDepth(depth())
        expect(cloud).toBeDefined()
        expect([cloud!.width, cloud!.height]).toEqual([2, 2])
        expect(cloud!.at(1, 1)).toEqual({ x: 7, y: 8, z: 9 })
    })

    test('maps source coordinates through the frame when it is given', () => {
        // the frame is the box for a scene cloud, so the whole source maps onto
        // the depth map's grid rather than onto an object's bounding box
        const cloud = cloudOfDepth(depth(), 640, 480)!
        expect(cloud.atSource(10, 10)).toEqual({ x: 1, y: 2, z: 3 })
        expect(cloud.atSource(600, 400)).toEqual({ x: 7, y: 8, z: 9 })
    })

    test('a depth map that was not back-projected carries no cloud', () => {
        expect(cloudOfDepth({ width: 2, height: 2, values: '' })).toBeUndefined()
        expect(cloudOfDepth(undefined)).toBeUndefined()
    })
})

describe('clouds of a whole prediction', () => {
    test('every masked object, nested ones included, with the scene last', () => {
        const prediction = {
            source_width: 640,
            source_height: 480,
            objects: [
                {
                    classLabel: 'person',
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 2,
                    mask: mask(),
                    objects: [{ classLabel: 'bag', x: 0, y: 0, width: 1, height: 1, mask: mask() }],
                },
                { classLabel: 'car', x: 0, y: 0, width: 2, height: 2 },
            ],
            depth: depth(),
        } as unknown as Prediction

        const clouds = cloudsOfPrediction(prediction)
        expect(clouds).toHaveLength(3)
        // last so an existing index into the object clouds keeps meaning what it did
        expect(clouds[2].atSource(600, 400)).toEqual({ x: 7, y: 8, z: 9 })
    })

    test('without a scene cloud only the masks come back', () => {
        const prediction = {
            objects: [{ classLabel: 'car', x: 0, y: 0, width: 2, height: 2, mask: mask() }],
            depth: { width: 2, height: 2, values: '' },
        } as unknown as Prediction
        expect(cloudsOfPrediction(prediction)).toHaveLength(1)
    })

    test('a prediction with nothing to place is empty', () => {
        expect(cloudsOfPrediction(undefined)).toHaveLength(0)
        expect(cloudsOfPrediction({ objects: [{ classLabel: 'car' }] } as unknown as Prediction)).toHaveLength(0)
    })
})
