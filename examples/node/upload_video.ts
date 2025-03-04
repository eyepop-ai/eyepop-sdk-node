import { EyePop, VideoMode } from '@eyepop.ai/eyepop'
import process from 'process'
import { pino } from 'pino'

const logger = pino({ level: 'debug', name: 'eyepop-example' })

async function upload_video(video_path: string, is_streaming: boolean, seconds: number) {
    const endpoint = await EyePop.workerEndpoint({ logger: logger }).connect()
    try {
        const results = await endpoint.process({
            path: video_path,
            videoMode: is_streaming? VideoMode.STREAM: undefined
        })
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
        const is_streaming = process.argv.length > 3 && process.argv[3].startsWith('s')
        const seconds = 60.0
        console.log(`using: ${video_file} for ${seconds} seconds`)
        await upload_video(video_file, is_streaming, seconds)
    } catch (e) {
        console.error(e)
    }
})()
