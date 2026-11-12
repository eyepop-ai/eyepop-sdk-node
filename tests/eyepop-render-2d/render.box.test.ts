import { describe, expect, jest, test } from '@jest/globals'
import { BoxType, RenderBox } from '../../src/eyepop-render-2d/render-box'
import { PredictedObject, StreamTime } from '../../src/eyepop'

function fakeContext() {
    return {
        canvas: { width: 1280, height: 720 },
        arc: jest.fn(),
        beginPath: jest.fn(),
        rect: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        fillText: jest.fn(),
        measureText: jest.fn(() => ({ width: 50, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 })),
        font: '',
        textAlign: '',
        textBaseline: '',
        lineWidth: 1,
        fillStyle: '',
        strokeStyle: '',
    }
}

const style = {
    font: '25px Times New Roman',
    scale: 1,
    cornerWidth: 0.3,
    cornerPadding: 0.04,
    colors: { primary_color: '#000', secondary_color: '#000', opacity_color: '#000' },
}

// a detector object with a crop forwarded to a classifier: its classes carry no category
function personWithClasses(): PredictedObject {
    return {
        classLabel: 'person',
        confidence: 0.937,
        trackId: 1,
        x: 324.9,
        y: 198.2,
        width: 196.2,
        height: 460.6,
        classes: [
            { classLabel: 'vehicle', confidence: 0.03 },
            { classLabel: 'person', confidence: 0.41 },
        ],
    } as PredictedObject
}

describe('RenderBox with nested classes that have no category', () => {
    test.each([BoxType.Rich, BoxType.Simple, BoxType.SimpleSelected])('%s draws every label', boxType => {
        const context = fakeContext()
        const box = new RenderBox({ boxType, showNestedClasses: true, showTrackId: true, showConfidence: true })
        // @ts-ignore a fake context and style draw nothing
        box.start(context, style)
        const element = personWithClasses()

        box.draw(element, 0, 0, 1, 1, {} as StreamTime)

        // every label is title-cased, the track id's "ID" included
        const labels = context.fillText.mock.calls.map(call => call[0])
        expect(labels).toEqual(['Person', 'Vehicle', 'Person', 'Id: 1', '94%'])
    })

    test("the caller's classes keep their order", () => {
        const context = fakeContext()
        const box = new RenderBox({ showNestedClasses: true })
        // @ts-ignore a fake context and style draw nothing
        box.start(context, style)
        const element = personWithClasses()
        element.classes![0].category = 'b'
        element.classes![1].category = 'a'

        box.draw(element, 0, 0, 1, 1, {} as StreamTime)

        // drawn in category order, but the prediction is left as received
        expect(context.fillText.mock.calls.map(call => call[0])).toEqual(['Person', 'Person', 'Vehicle'])
        expect(element.classes!.map(c => c.classLabel)).toEqual(['vehicle', 'person'])
    })
})
