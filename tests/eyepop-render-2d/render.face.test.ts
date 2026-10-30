import { describe, expect, jest, test } from '@jest/globals'
import { RenderFace } from '../../src/eyepop-render-2d/render-face'
import { PredictedObject, StreamTime } from '../../src/eyepop'

function fakeContext() {
    return {
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        lineWidth: 1,
        fillStyle: '',
        strokeStyle: '',
    }
}

const STYLE = { scale: 1, colors: { primary_color: '#000', secondary_color: '#111', right_color: '#222', left_color: '#333' } }

function face(): PredictedObject {
    const points = Array.from({ length: 478 }, (_, i) => ({ x: i, y: i, z: 0 }))
    return { classLabel: 'face', x: 0, y: 0, width: 10, height: 10, meshes: [{ category: '3d-face-mesh', confidence: 1, points }] }
}

describe('face meshes in the 2d renderer', () => {
    test('a face mesh is drawn from meshes', () => {
        const context = fakeContext()
        const render = new RenderFace()
        // @ts-ignore a fake context and style draw nothing
        render.start(context, STYLE)

        render.draw(face(), 0, 0, 1, 1, {} as StreamTime)

        expect(context.moveTo).toHaveBeenCalled()
    })
})
