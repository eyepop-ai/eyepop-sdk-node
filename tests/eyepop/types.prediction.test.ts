import { describe, expect, test } from '@jest/globals'
import type { Prediction } from '../../src/eyepop'

describe('Prediction result types', () => {
    test('accepts the live PlayerU persistent session result shape', () => {
        const frame = {
            duration: 41708333,
            objects: [
                {
                    category: 'ball',
                    classLabel: 'ball',
                    confidence: 0.8722,
                    height: 45.751,
                    orientation: 0,
                    width: 57.836,
                    x: 506.138,
                    y: 349.121,
                },
                {
                    category: 'paddle_spine',
                    classLabel: 'paddle spine',
                    confidence: 0.7347,
                    height: 27.047,
                    keyPoints: [
                        {
                            category: 'paddle_spine',
                            points: [
                                {
                                    visible: true,
                                    x: 936.551,
                                    y: 652.47,
                                },
                                {
                                    visible: true,
                                    x: 896.837,
                                    y: 625.423,
                                },
                            ],
                        },
                    ],
                    orientation: 0,
                    width: 39.714,
                    x: 896.837,
                    y: 625.423,
                },
            ],
            seconds: 0.375375,
            source_height: 1080,
            source_id: 'a9297e9e-4f99-11f1-8bc3-da17dd8585f2',
            source_width: 1920,
            system_timestamp: 1778765682008756000,
            timestamp: 375375000,
        } satisfies Prediction

        expect(frame.objects?.[1]?.keyPoints?.[0]?.points).toHaveLength(2)
        expect(frame.system_timestamp).toBeDefined()
    })
})
