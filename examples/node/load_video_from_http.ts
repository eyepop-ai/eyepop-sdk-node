import {EyePop} from '../../src/eyepop'

async function load_video_from_url(video_url: string, seconds: number) {
    const endpoint = await EyePop.workerEndpoint().connect()
    try {
        const results = await endpoint.process({url: video_url})
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


(async() => {
    try {
        const video_url = 'https://demo-eyepop-videos.s3.amazonaws.com/test1_vlog.mp4'
        const seconds = 10.0
        console.log(`using: ${video_url} for ${seconds} seconds`)
        await load_video_from_url(video_url, seconds)
    } catch (e) {
        console.error(e)
    }
})()
