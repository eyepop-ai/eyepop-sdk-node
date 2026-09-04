/**
 * Decoding and sampling of point clouds.
 *
 * When a pipeline is asked for world coordinates, an object carrying a
 * segmentation mask also carries `mask.world`: three little-endian float32
 * values per mask pixel, row-major, exactly width*height triples. The point for
 * bitmap pixel (i, j) sits at triple index j * width + i, so the cloud indexes
 * exactly like the bitmap with no separate lookup.
 *
 * A Pop asking for `depthMap.toWorld` also gets `depth.world`, the same
 * encoding on the depth map's own grid: one point per map pixel rather than per
 * mask pixel, covering the whole scene.
 *
 * Points the worker could not place are NaN - sky pixels, samples outside the
 * depth map, and pixels the mask does not cover. NaN is the omission sentinel
 * here, which is why this does not share decodeDepthMap()'s validation: that
 * one rejects a payload of the wrong length, but nothing here may reject a NaN.
 */

import { Depth, Mask, Prediction, PredictedObject } from './types'

/** One xyz triple per pixel, so a cloud is three float32 per pixel. */
const VALUES_PER_POINT = 3

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

/** Where a cloud's grid sits in the source frame, so at() can be reached from source pixels. */
export interface CloudBox {
    x: number
    y: number
    width: number
    height: number
}

/**
 * A decoded point cloud, per object or per scene.
 *
 * Create with decodePointCloud(), cloudOfObject(), cloudOfDepth() or
 * cloudsOfPrediction(). Coordinates are metres, in the frame the source's
 * camera extrinsics define (Z up, ground at Z = 0) or the OpenCV camera frame
 * when it supplied none.
 *
 * The grid is whatever the cloud was made from: an object's mask, which spans
 * its bounding box rather than the frame, or the depth map itself, which spans
 * the whole frame. Either way (i, j) is a source coordinate only via that box,
 * which cloudOfObject() and cloudOfDepth() record - so atSource() needs one of
 * those two.
 */
export class PointCloud {
    readonly width: number
    readonly height: number
    /** xyz per pixel, row-major; an omitted point is NaN in all three. */
    readonly points: Float32Array
    private readonly box: CloudBox | undefined

    constructor(width: number, height: number, points: Float32Array, box?: CloudBox) {
        this.width = width
        this.height = height
        this.points = points
        this.box = box
    }

    /**
     * The world point for pixel (i, j), or undefined where the worker placed none.
     *
     * (i, j) indexes the cloud's own grid - the mask bitmap, or the depth map
     * for a scene cloud: i is the column, j is the row.
     */
    public at(i: number, j: number): Vector3 | undefined {
        if (!(i >= 0 && i < this.width && j >= 0 && j < this.height)) {
            throw new Error(`(${i}, ${j}) is outside a ${this.width}x${this.height} cloud`)
        }
        const offset = (j * this.width + i) * VALUES_PER_POINT
        const x = this.points[offset]
        const y = this.points[offset + 1]
        const z = this.points[offset + 2]
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
            return undefined
        }
        return { x, y, z }
    }

    /**
     * The world point for a source frame coordinate inside the cloud's box.
     *
     * Needs a cloud built with cloudOfObject(), or with cloudOfDepth() and the
     * frame size: the grid covers a box, and nothing else knows where it sits.
     */
    public atSource(x: number, y: number): Vector3 | undefined {
        if (this.box === undefined) {
            throw new Error('atSource needs a box; build with cloudOfObject or cloudOfDepth')
        }
        if (!(this.box.width > 0) || !(this.box.height > 0)) {
            throw new Error(`invalid bounding box extent: ${this.box.width}x${this.box.height}`)
        }
        // the inverse of the worker's own grid-to-source transform, which
        // samples pixel centres: source = box + ((index + 0.5) / extent) * box_extent
        const i = Math.min(Math.max(Math.floor(((x - this.box.x) / this.box.width) * this.width), 0), this.width - 1)
        const j = Math.min(Math.max(Math.floor(((y - this.box.y) / this.box.height) * this.height), 0), this.height - 1)
        return this.at(i, j)
    }

    public isPlaced(i: number, j: number): boolean {
        return this.at(i, j) !== undefined
    }

    /**
     * Just the points the worker placed.
     *
     * The shape a scatter plot or an export wants: the grid with its NaN holes
     * dropped, and no mask to apply first.
     */
    public get placedPoints(): Vector3[] {
        const placed: Vector3[] = []
        for (let offset = 0; offset < this.points.length; offset += VALUES_PER_POINT) {
            const x = this.points[offset]
            const y = this.points[offset + 1]
            const z = this.points[offset + 2]
            if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
                placed.push({ x, y, z })
            }
        }
        return placed
    }

    /**
     * Per axis (min, max) in metres over the placed points, or undefined if none were.
     *
     * The counterpart to DepthMap's finiteMin/finiteMax, which are one axis
     * because a depth map has one value per pixel.
     */
    public get bounds(): CloudBounds | undefined {
        let found = false
        const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY }
        const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY }
        for (let offset = 0; offset < this.points.length; offset += VALUES_PER_POINT) {
            const x = this.points[offset]
            const y = this.points[offset + 1]
            const z = this.points[offset + 2]
            if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
                continue
            }
            found = true
            min.x = Math.min(min.x, x)
            min.y = Math.min(min.y, y)
            min.z = Math.min(min.z, z)
            max.x = Math.max(max.x, x)
            max.y = Math.max(max.y, y)
            max.z = Math.max(max.z, z)
        }
        return found ? { min, max } : undefined
    }
}

export interface Vector3 {
    x: number
    y: number
    z: number
}

export interface CloudBounds {
    min: Vector3
    max: Vector3
}

function decode(width: number, height: number, world: string, box: CloudBox | undefined): PointCloud {
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
        throw new Error(`invalid point cloud dimensions: ${width}x${height}`)
    }
    const bytes = base64ToBytes(world)
    const count = width * height * VALUES_PER_POINT
    if (bytes.byteLength !== count * 4) {
        throw new Error(`'world' holds ${bytes.byteLength} bytes, expected ${count * 4} for ${width}x${height} xyz float32`)
    }
    let points: Float32Array
    if (isLittleEndianPlatform) {
        // copy to a fresh, aligned buffer (e.g. Buffer pool slices can be unaligned)
        const aligned = new Uint8Array(bytes)
        points = new Float32Array(aligned.buffer, 0, count)
    } else {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        points = new Float32Array(count)
        for (let i = 0; i < count; i++) {
            points[i] = view.getFloat32(i * 4, true)
        }
    }
    return new PointCloud(width, height, points, box)
}

/** A mask's point cloud, or undefined if it carries none. */
export function decodePointCloud(mask: Mask | undefined, box?: CloudBox): PointCloud | undefined {
    if (mask === undefined || mask.world === undefined) {
        return undefined
    }
    return decode(mask.width, mask.height, mask.world, box)
}

/**
 * The point cloud of a predicted object's mask, or undefined if it has none.
 *
 * Records the object's bounding box, so atSource() works.
 */
export function cloudOfObject(obj: PredictedObject | undefined): PointCloud | undefined {
    if (obj === undefined || obj.mask === undefined) {
        return undefined
    }
    return decodePointCloud(obj.mask, { x: obj.x, y: obj.y, width: obj.width, height: obj.height })
}

/**
 * The scene point cloud of a frame level depth map, or undefined if it has none.
 *
 * Present when the Pop asked for `depthMap.toWorld`. Unlike a mask cloud this
 * one spans the whole frame, so its grid is the depth map's rather than an
 * object's bounding box - and at(i, j) indexes map pixels, the same index that
 * pixel's value sits at in `depth.values`.
 *
 * Pass the prediction's source_width/source_height to enable atSource(); the
 * frame is the box in this case.
 */
export function cloudOfDepth(depth: Depth | undefined, sourceWidth?: number, sourceHeight?: number): PointCloud | undefined {
    if (depth === undefined || depth.world === undefined) {
        return undefined
    }
    const box = sourceWidth && sourceHeight ? { x: 0, y: 0, width: sourceWidth, height: sourceHeight } : undefined
    return decode(depth.width, depth.height, depth.world, box)
}

/**
 * Every point cloud in a prediction, outermost object first.
 *
 * An array rather than a single value like decodeDepthMap(), because a cloud
 * belongs to one object's mask and a prediction carries as many as it has
 * masked objects. Nested objects are included. A scene cloud, if the Pop asked
 * for one, comes last - appended rather than inserted so an existing index into
 * the object clouds keeps meaning what it did.
 */
export function cloudsOfPrediction(prediction: Prediction | undefined): PointCloud[] {
    const clouds: PointCloud[] = []
    if (prediction === undefined) {
        return clouds
    }

    const walk = (objects: Array<PredictedObject> | undefined): void => {
        for (const obj of objects ?? []) {
            const cloud = cloudOfObject(obj)
            if (cloud !== undefined) {
                clouds.push(cloud)
            }
            walk(obj.objects)
        }
    }
    walk(prediction.objects)

    const scene = cloudOfDepth(prediction.depth, prediction.source_width, prediction.source_height)
    if (scene !== undefined) {
        clouds.push(scene)
    }
    return clouds
}
