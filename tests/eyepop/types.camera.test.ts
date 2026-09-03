import { describe, expect, test } from '@jest/globals'
import type { Camera, Pop } from '../../src/eyepop'
import { PopComponentType, validateCamera, validatePop } from '../../src/eyepop'

function intrinsics(overrides: Partial<Camera['intrinsics']> = {}) {
    return { fx: 0.9, fy: 1.6, cx: 0.5, cy: 0.5, ...overrides }
}

describe('camera calibration', () => {
    test('a lens described by intrinsics or by field of view is accepted', () => {
        expect(() => validateCamera({ intrinsics: intrinsics() })).not.toThrow()
        expect(() => validateCamera({ hfovDegrees: 72 })).not.toThrow()
    })

    test('both descriptions of one lens are rejected rather than resolved', () => {
        // two that disagree have no right answer, so precedence would be a guess
        expect(() => validateCamera({ intrinsics: intrinsics(), hfovDegrees: 72 })).toThrow()
    })

    test('a camera describing no lens is rejected', () => {
        // defaulting a focal length would be inventing a lens
        expect(() => validateCamera({})).toThrow()
    })

    test('a field of view outside (0, 180) is rejected, non-finite included', () => {
        for (const hfovDegrees of [0, 180, -10, Number.POSITIVE_INFINITY, Number.NaN]) {
            expect(() => validateCamera({ hfovDegrees })).toThrow()
        }
    })

    test('a focal length must be positive and finite', () => {
        for (const fx of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
            expect(() => validateCamera({ intrinsics: intrinsics({ fx }) })).toThrow()
        }
    })

    test('a principal point must sit within the frame', () => {
        expect(() => validateCamera({ intrinsics: intrinsics({ cx: -0.1 }) })).toThrow()
        expect(() => validateCamera({ intrinsics: intrinsics({ cy: 1.1 }) })).toThrow()
        expect(() => validateCamera({ intrinsics: intrinsics({ cx: 0, cy: 1 }) })).not.toThrow()
    })

    test('distortion coefficients must be finite', () => {
        expect(() => validateCamera({ hfovDegrees: 72, distortion: { k1: Number.NaN } })).toThrow()
        expect(() => validateCamera({ hfovDegrees: 72, distortion: { k1: -0.2, k2: 0.05 } })).not.toThrow()
    })

    test('a rotation must be a unit quaternion', () => {
        const pose = (rotation: { w: number; x: number; y: number; z: number }) => () => validateCamera({ hfovDegrees: 72, extrinsics: { rotation } })
        expect(pose({ w: 1, x: 1, y: 0, z: 0 })).toThrow()
        expect(pose({ w: Number.NaN, x: 0, y: 0, z: 0 })).toThrow()
        expect(pose({ w: 0.7071, x: -0.7071, y: 0, z: 0 })).not.toThrow()
        // loose enough to survive a float round trip through JSON
        expect(pose({ w: 1.0005, x: 0, y: 0, z: 0 })).not.toThrow()
    })

    test('a translation must be finite', () => {
        expect(() => validateCamera({ hfovDegrees: 72, extrinsics: { translation: { x: 0, y: 0, z: Number.NaN } } })).toThrow()
        expect(() => validateCamera({ hfovDegrees: 72, extrinsics: { translation: { x: 0, y: 0, z: 5 } } })).not.toThrow()
    })
})

describe('pop world coordinate contract', () => {
    const detector = { type: PopComponentType.INFERENCE, ability: 'eyepop.person:latest' }

    test('a component opts in with toWorld', () => {
        const pop: Pop = { components: [{ ...detector, toWorld: true }], depthMap: { ability: 'eyepop.depth.anything-3:latest' } }
        expect(() => validatePop(pop)).not.toThrow()
        expect(JSON.parse(JSON.stringify(pop)).components[0].toWorld).toBe(true)
    })

    test('the depth map can ask for the whole scene on its own', () => {
        // it is a consumer in its own right, so no component has to opt in
        const pop: Pop = { components: [detector], depthMap: { ability: 'eyepop.depth.anything-3:latest', toWorld: true } }
        expect(() => validatePop(pop)).not.toThrow()
    })

    test('a depth map naming neither ability nor abilityUuid is rejected', () => {
        // a depth branch that cannot be built, which the worker answers with a 400
        expect(() => validatePop({ components: [detector], depthMap: {} })).toThrow()
        expect(() => validatePop({ components: [detector], depthMap: { toWorld: true } })).toThrow()
    })

    test('a depth map naming both is rejected', () => {
        expect(() => validatePop({ components: [detector], depthMap: { ability: 'a', abilityUuid: 'u' } })).toThrow()
    })

    test('either selector alone is accepted', () => {
        expect(() => validatePop({ components: [detector], depthMap: { ability: 'a' } })).not.toThrow()
        expect(() => validatePop({ components: [detector], depthMap: { abilityUuid: 'u' } })).not.toThrow()
    })

    test('a pop wanting no enrichment carries none of it', () => {
        const pop: Pop = { components: [detector] }
        expect(() => validatePop(pop)).not.toThrow()
        expect(JSON.parse(JSON.stringify(pop))).not.toHaveProperty('depthMap')
        expect(JSON.parse(JSON.stringify(pop)).components[0]).not.toHaveProperty('toWorld')
    })

    test('a defaulted camera is validated with the pop that carries it', () => {
        expect(() => validatePop({ components: [detector], defaults: { camera: {} } })).toThrow()
        expect(() => validatePop({ components: [detector], defaults: { camera: { hfovDegrees: 72 } } })).not.toThrow()
    })
})
