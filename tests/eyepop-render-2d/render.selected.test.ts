import { describe, expect, jest, test } from '@jest/globals'
import { Renderer2d } from '../../src/eyepop-render-2d/renderer-2d'
import { RenderTrail } from '../../src/eyepop-render-2d/render-trail'
import { Prediction } from '../../src/eyepop'

function fakeContext() {
    return {
        canvas: { width: 100, height: 100 },
        arc: jest.fn(),
        beginPath: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        globalAlpha: 1,
        fillStyle: '',
        strokeStyle: '',
    }
}

const SECOND = 1000 * 1000 * 1000

function prediction(timestamp: number, selected: boolean = false): Prediction {
    return {
        source_width: 100,
        source_height: 100,
        timestamp,
        selected,
        objects: [{ trackId: 7, x: 10, y: 10, width: 20, height: 20, confidence: 1, classLabel: 'person' }],
    }
}

describe('selected predictions in the 2d renderer', () => {
    test('a selected prediction is not drawn over the current frame', () => {
        const context = fakeContext()
        // @ts-ignore a fake context draws nothing
        const renderer = new Renderer2d({ context, rules: [new RenderTrail({ trailLengthSeconds: 10 })] })

        renderer.draw(prediction(5 * SECOND, true))

        expect(context.arc).not.toHaveBeenCalled()
    })

    test('a trail ignores an object older than its head', () => {
        const context = fakeContext()
        const trail = new RenderTrail({ trailLengthSeconds: 10 })
        // @ts-ignore a fake context and style draw nothing
        trail.start(context, { colors: { secondary_color: '#fff' } })
        // driven directly: Renderer2d's jsonpath lookup does not load under
        // jest's ESM mode, and the trail is what a past object would corrupt
        const draw = (timestamp: number) => {
            const p = prediction(timestamp)
            trail.draw(p.objects![0], 0, 0, 1, 1, p)
        }

        draw(5 * SECOND)
        draw(1 * SECOND)
        context.arc.mockClear()
        draw(6 * SECOND)

        // the head at 6s and the entry at 5s; the past one never joined
        expect(context.arc).toHaveBeenCalledTimes(2)
    })
})
