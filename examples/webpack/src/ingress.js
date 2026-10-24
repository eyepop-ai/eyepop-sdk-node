import { AreaType, EyePop, PopComponentType } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

let endpoint = undefined
let popNameElement = undefined
let connectButton = undefined
let startButton = undefined
let stopButton = undefined
let roiSwitch = undefined
let timingSpan = undefined
let resultSpan = undefined
let cameraStatus = undefined

let resultStream = undefined
let starting = false

let localVideo = undefined
let localResultOverlay = undefined
let localOverlayContext = undefined

async function setup() {
    popNameElement = document.getElementById('pop-name')
    connectButton = document.getElementById('connect')
    startButton = document.getElementById('start-stream')
    stopButton = document.getElementById('stop-stream')
    roiSwitch = document.getElementById('roi-switch')
    timingSpan = document.getElementById('timing')
    resultSpan = document.getElementById('txt_json')
    cameraStatus = document.getElementById('camera-status')

    localVideo = document.getElementById('local-video')
    localResultOverlay = document.getElementById('local-result-overlay')
    localOverlayContext = localResultOverlay.getContext('2d')

    connectButton.addEventListener('click', connectOnce)
    startButton.addEventListener('click', startLocalStream)
    stopButton.addEventListener('click', stopStream)

    const allowButton = document.getElementById('allow-camera')
    allowButton.addEventListener('click', allowCamera)
    connectButton.disabled = false
    // connect at once; the camera starts as soon as it is allowed, with no Connect or Start to press
    connectOnce().catch(error => showCamera('Could not connect: ' + error.message, true))
    if (!navigator.mediaDevices) {
        // a browser exposes the camera only on https or http://localhost, never on an IP or a .local name
        allowButton.disabled = true
        showCamera('No camera access here: open this page as http://localhost:8000/ or over https.', true)
        return
    }
    navigator.mediaDevices.addEventListener('devicechange', populateDevices)
    document.getElementById('video_device').addEventListener('change', restartStream)
    await populateDevices()
    // the browser names the cameras only after the camera is allowed once; ask now if it is not already
    const permission = await navigator.permissions?.query({ name: 'camera' }).catch(() => undefined)
    if (permission?.state === 'granted') {
        showCamera('Camera allowed.')
        autoStart()
    } else if (permission?.state === 'denied') {
        showCamera('Camera blocked for this page: allow it from the camera icon in the address bar, then press Allow camera.', true)
    } else {
        showCamera('Press Allow camera, then choose Allow in the browser prompt.')
    }
    permission?.addEventListener('change', allowCameraChanged)
}

function showCamera(text, problem = false) {
    cameraStatus.textContent = text
    cameraStatus.style.color = problem ? '#f0883e' : ''
}

function allowCameraChanged(event) {
    if (event.target.state === 'granted') {
        populateDevices()
        showCamera('Camera allowed.')
        autoStart()
    }
}

// Asks the browser for the camera once, so that it shows its prompt now and names the cameras in the list.
async function allowCamera() {
    try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true })
        probe.getTracks().forEach(track => track.stop())
        await populateDevices()
        showCamera('Camera allowed.')
        autoStart()
    } catch (error) {
        showCamera(cameraProblem(error), true)
    }
}

function cameraProblem(error) {
    switch (error.name) {
        case 'NotAllowedError':
            return 'Camera blocked: allow it from the camera icon in the address bar, then press Allow camera.'
        case 'NotFoundError':
            return 'No camera found on this machine; choose screen in the list to share a window instead.'
        case 'NotReadableError':
            return 'The camera is in use by another application.'
        default:
            return 'Camera error: ' + error.message
    }
}

async function populateDevices() {
    return navigator.mediaDevices.enumerateDevices().then(devices => {
        const list = document.getElementById('video_device')
        const chosen = list.value
        list.replaceChildren()
        for (const device of devices) {
            switch (device.kind) {
                case 'videoinput':
                    {
                        const opt = document.createElement('option')
                        opt.value = device.deviceId
                        // the label is empty until the camera is allowed once
                        opt.text = device.label || 'Camera ' + (list.children.length + 1)
                        list.appendChild(opt)
                    }
                    break
            }
        }

        // add screen
        const opt = document.createElement('option')
        opt.value = 'screen'
        opt.text = 'screen'
        document.getElementById('video_device').appendChild(opt)

        // set default: the one chosen before, else the first source, a camera; the last is 'screen'
        list.value = [...list.children].some(o => o.value === chosen) ? chosen : list.children[0].value
    })
}

let connecting = undefined

function connectOnce() {
    // a second call waits for the first; a failed connection can be tried again
    connecting ??= connect().catch(error => {
        connecting = undefined
        throw error
    })
    return connecting
}

async function connect() {
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
                confidenceThreshold: 0.8
            }]
        })
    }
    popNameElement.textContent = endpoint.popName() || 'connected'
    popNameElement.parentElement.dataset.on = ''
    connectButton.hidden = true
    startButton.disabled = false
}

// Starts the chosen camera unless one is starting or already streams.
function autoStart() {
    if (!localVideo.srcObject && !starting) {
        startLocalStream()
    }
}

// A new choice in the list moves the stream to it.
async function restartStream() {
    if (localVideo.srcObject) {
        await stopStream()
    }
    startLocalStream()
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
    starting = true
    startButton.disabled = true
    await connectOnce()
    startButton.disabled = true // connecting enables it
    const startTime = performance.now()
    timingSpan.innerHTML = '__ms'
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>"
    const videoId = document.getElementById('video_device').value
    let stream = undefined
    try {
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
        stream = await navigator.mediaDevices.getUserMedia({
            video: videoId ? { deviceId: { exact: videoId } } : true,
        })
    }
    } catch (error) {
        showCamera(cameraProblem(error), true)
        starting = false
        startButton.disabled = false
        timingSpan.innerHTML = '__ms'
        resultSpan.innerHTML = ''
        return
    }
    showCamera('Streaming from ' + (stream.getVideoTracks()[0]?.label || videoId) + '.')
    localVideo.srcObject = stream
    localVideo.play()
    timingSpan.innerHTML = Math.floor(performance.now() - startTime) + 'ms'
    stopButton.disabled = false

    const checkedMotionRadio = document.querySelector('input[name="motion-detect-options"]:checked')
    const motionSensitivity = parseFloat(checkedMotionRadio.value)
    /*
        Starting live processing from local MediaStream instance,
        stop processing by calling resultStream.cancel().
     */
    resultStream = await endpoint.process({
        source: {
            mediaStream: stream
        },
        motionDetect: motionSensitivity > 0.0 ? {
            motionDetect: true,
            motionSensitivity: motionSensitivity
        } : undefined,
        roi: roiSwitch.checked ? {
            type: AreaType.RECTANGLE,
            x: 160,
            y: 0,
            width: 320,
            height: 480
        } : undefined,
    })
    /*
        Asynchronous result processing, in ths demo, render as overlay
        over local video and print JSON results in text box underneath.
     */
    renderFromResultStream(resultStream).finally(() => {
        console.log("result stream finished")
    })
}

async function stopStream(event) {
    starting = false
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
