import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

console.log('Hello EyePop Demo')

let endpoint = undefined
let popNameElement = undefined
let connectButton = undefined
let startButton = undefined
let stopButton = undefined
let timingSpan = undefined
let resultSpan = undefined

let resultStream = undefined

let localVideo = undefined
let localResultOverlay = undefined
let localOverlayContext = undefined

async function setup() {
    popNameElement = document.getElementById('pop-name')
    connectButton = document.getElementById('connect')
    startButton = document.getElementById('start-stream')
    stopButton = document.getElementById('stop-stream')
    timingSpan = document.getElementById('timing')
    resultSpan = document.getElementById('txt_json')

    localVideo = document.getElementById('local-video')
    localResultOverlay = document.getElementById('local-result-overlay')
    localOverlayContext = localResultOverlay.getContext('2d')

    connectButton.addEventListener('click', connect)
    startButton.addEventListener('click', startLocalStream)
    stopButton.addEventListener('click', stopStream)

    connectButton.disabled = false
    await populateDevices()
}

async function populateDevices() {
    return navigator.mediaDevices.enumerateDevices().then(devices => {
        for (const device of devices) {
            console.log(device)
            switch (device.kind) {
                case 'videoinput':
                    {
                        const opt = document.createElement('option')
                        opt.value = device.deviceId
                        opt.text = device.label
                        document.getElementById('video_device').appendChild(opt)
                    }
                    break
            }
        }

        // add screen
        const opt = document.createElement('option')
        opt.value = 'screen'
        opt.text = 'screen'
        document.getElementById('video_device').appendChild(opt)

        // set default
        document.getElementById('video_device').value = document.getElementById('video_device').children[1].value
    })
}

async function connect(event) {
    if (!endpoint) {
        const session = await (await fetch('eyepop-session.json')).json()
        endpoint = await EyePop.workerEndpoint({
            auth: { session: session },
        })
        await endpoint.connect()
        // Compose your Pop here
        await endpoint.changePop({
            components: [{
                type: PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
            }]
        })
    }
    popNameElement.innerHTML = endpoint.popName()
    startButton.disabled = false
}

async function renderFromResultStream(results) {
    const localRender = Render2d.renderer(localOverlayContext, [
        Render2d.renderBox('$..objects[?(@.classLabel=="face")]'),
        Render2d.renderTrail(1.0, '$..keyPoints[?(@.category=="3d-body-points")].points[?(@.classLabel.includes("nose"))]'),
    ])
    for await (let result of results) {
        resultSpan.textContent = JSON.stringify(result, ' ', 2)

        if (localVideo.srcObject) {
            localResultOverlay.width = result.source_width
            localResultOverlay.height = result.source_height
            localOverlayContext.clearRect(0, 0, localResultOverlay.width, localResultOverlay.height)
            localRender.draw(result)
        }
    }
}

async function startLocalStream(event) {
    const startTime = performance.now()
    timingSpan.innerHTML = '__ms'
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>"
    startButton.disabled = true
    const videoId = document.getElementById('video_device').value
    let stream = undefined
    if (videoId == 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
                cursor: 'always',
            },
            audio: false,
        })
    } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: videoId } })
    }
    localVideo.srcObject = stream
    localVideo.play()
    timingSpan.innerHTML = Math.floor(performance.now() - startTime) + 'ms'
    stopButton.disabled = false
    /*
        Starting live processing from local MediaStream instance,
        stop processing by calling resultStream.cancel().
     */
    resultStream = await endpoint.process({ mediaStream: stream })
    /*
        Asynchronous result processing, in ths demo, render as overlay
        over local video and print JSON results in text box underneath.
     */
    renderFromResultStream(resultStream).finally(() => {
        console.log("result stream finished")
    })
}

async function stopStream(event) {
    stopButton.disabled = true
    localVideo.pause()
    localVideo.srcObject = null
    localOverlayContext.clearRect(0, 0, localResultOverlay.width, localResultOverlay.height)
    startButton.disabled = false
    /*
        Stop processing of live stream if currently running.
     */
    if (resultStream) {
        resultStream.cancel()
        resultStream = null
    }
}

document.addEventListener('DOMContentLoaded', async event => {
    await setup()
})
