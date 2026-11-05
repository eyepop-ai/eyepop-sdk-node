import { describe, expect, test } from '@jest/globals'
import { pino } from 'pino'
import { InferAssetJob } from '../../../src/eyepop/data/jobs'
import { Prediction } from '../../../src/eyepop'

async function inferJob(response: Record<string, any>): Promise<InferAssetJob> {
    const vlmFetch = async () => ({ predictions: [{ source_width: 1, source_height: 1 }], ...response })
    const job = new InferAssetJob('https://images.example/a.jpg', { worker_release: 'qwen3-instruct' } as any, vlmFetch, pino({ level: 'silent' }))
    job.start(() => {})
    const predictions: Prediction[] = []
    for await (const prediction of job) {
        predictions.push(prediction)
    }
    expect(predictions).toHaveLength(1)
    return job
}

describe('InferAssetJob compute units', () => {
    test.each([
        [{ milli_compute_units: 331, compute_units: 330 }, 331],
        [{ compute_units: 330 }, 330],
        [{ milli_compute_units: null, compute_units: 330 }, 330],
        [{}, undefined],
    ])('%p gives milliComputeUnits %p', async (usage, expected) => {
        expect((await inferJob(usage)).milliComputeUnits).toBe(expected)
    })
})
