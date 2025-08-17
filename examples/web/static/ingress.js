console.log('Hello EyePop Demo')

let endpoint = undefined
let popNameElement = undefined
let connectButton = undefined
let startButton = undefined
let stopButton = undefined
let timingSpan = undefined
let resultSpan = undefined
let pop = undefined
let update = undefined


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
    pop = document.getElementById('pop-comp')
    update = document.getElementById('update-pop-comp')

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
        const queryString = window.location.search
        const urlParams = new URLSearchParams(queryString)
        const eyepopUrl = urlParams.get('eyepopUrl') || undefined

        endpoint = await EyePop.workerEndpoint({
            auth: { oAuth2: true },
            popId: TransientPopId.transient,
            eyepopUrl: eyepopUrl,
        }).onStateChanged((from, to) => {
            console.log('Endpoint state transition from ' + from + ' to ' + to)
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
    pop.value = JSON.stringify(endpoint.pop())
    pop.style.overflow = 'hidden'
    pop.style.height = 0
    pop.style.height = pop.scrollHeight + 'px'

    pop.addEventListener('change', async event => {
        console.log('pop changed')
        update.disabled = false
        await endpoint.changePop(JSON.parse(pop.value))
    })

    update.addEventListener('click', event => {
        console.log('updated')
        update.disabled = true
    })
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
