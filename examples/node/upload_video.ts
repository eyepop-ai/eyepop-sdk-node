import { EyePop } from '../../src/eyepop'
import process from 'process'
import { pino } from 'pino'

const logger = pino({ level: 'debug', name: 'eyepop-example' })

async function upload_video(video_path: string, seconds: number) {
    const endpoint = await EyePop.workerEndpoint({ logger: logger }).connect()
    try {
        const results = await endpoint.process({ path: video_path })
        for await (let result of results) {
            // @ts-ignore
            if (result['seconds'] >= seconds) {
                results.cancel()
            }
            console.log(result)
        }
    } finally {
        await endpoint.disconnect()
    }
}

;(async () => {
    try {
        const video_file = process.argv[2]
        const seconds = 60.0
        console.log(`using: ${video_file} for ${seconds} seconds`)
        await upload_video(video_file, seconds)
    } catch (e) {
        console.error(e)
    }
})()
