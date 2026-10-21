/**
 * Runs a worker endpoint in pipeline mode: the same calls as with a worker session, on the pipeline API.
 *
 * Run it with EYEPOP_API_KEY set and EYEPOP_URL naming the compute API:
 * `npx tsx examples/node/pipeline_mode.ts examples/example.jpg examples/large_example.jpg`.
 */
import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'
import { pino } from 'pino'
import process from 'process'

const logger = pino({ level: 'info', name: 'eyepop-example' })

;(async () => {
    const endpoint = await EyePop.workerEndpoint({
        isPipelineMode: true,
        logger,
        pop: { components: [{ type: PopComponentType.INFERENCE, ability: 'eyepop.person:latest' }] },
    }).connect()
    try {
        const paths = process.argv.slice(2)
        // Each job goes out on the one socket as soon as it is submitted; the pipeline runs them in order.
        const jobs = []
        for (const path of paths) {
            jobs.push(await endpoint.process({ source: { path } }))
        }
        for (const [i, job] of jobs.entries()) {
            for await (const prediction of job) {
                logger.info('%s: %d objects', paths[i], prediction.objects?.length ?? 0)
            }
        }
    } finally {
        await endpoint.disconnect()
    }
})()
