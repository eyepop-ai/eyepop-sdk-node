/*
 * Measures the distance between a person's hands, live, from a webcam.
 *
 * A 2d-body-points component asks for world coordinates, back-projected
 * through a frame level depth map, and the two wrists come back in metres.
 * The wrists are the hands here: the 2D body model has no hand point of its
 * own, and a wrist is the closest joint it does place.
 */

// The body model's own labels for the two joints, matched by label rather than
// index: the label is what identifies a joint, and a model emitting its points
// in another order would otherwise be measured between the wrong two.
const LEFT_HAND = 'left wrist'
const RIGHT_HAND = 'right wrist'

const BODY_POINTS_CATEGORY = '2d-body-points'

// Metric, and large rather than small: the distance is only as good as the
// depth it is read from. A 'relative' depth ability is accepted by the worker
// and silently yields no world coordinates at all, because relative depth is
// scale- and shift-invariant.
const DEPTH_ABILITY = 'eyepop.depth.large:latest'

let endpoint = undefined
let resultStream = undefined
let probedSettings = undefined

let connectButton, startButton, stopButton, deviceSelect, statusLine
let detectedLine, hfovInput, deriveButton, fxInput, fyInput, cxInput, cyInput
let popNameElement, popJsonElement, measurementsList
let localVideo, overlay, overlayContext

function handDistancePop() {
    return {
        components: [
            {
                type: PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person',
                forward: {
                    operator: {
                        type: EyePopSdk.ForwardOperatorType.CROP,
                        crop: { maxItems: 16 },
                    },
                    targets: [
                        {
                            type: PopComponentType.INFERENCE,
                            model: 'eyepop.person.2d-body-points:latest',
                            categoryName: BODY_POINTS_CATEGORY,
                            confidenceThreshold: 0.25,
                            // this is the component whose points get back-projected;
                            // the person box above has no points to place
                            toWorld: true,
                        },
                    ],
                },
            },
        ],
        // named but not revealed: without toWorld the worker keeps the depth
        // branch out of the response, which on a live stream is the difference
        // between a few key points and a megabyte of base64 per frame
        depthMap: { ability: DEPTH_ABILITY },
    }
}

/*
 * Intrinsics for an assumed field of view, in the frame's own units.
 *
 * The same arithmetic the worker applies to a `hfovDegrees` shorthand, so
 * typing the field of view here and sending the shorthand instead would place
 * points identically. It is written out because the four numbers are what a
 * real calibration replaces.
 *
 * Square pixels: one focal length in pixels, divided by the width for fx and
 * by the height for fy, which is what leaves fy/fx equal to the aspect ratio.
 */
function intrinsicsFromHfov(hfovDegrees, width, height) {
    const focalPixels = width / 2 / Math.tan((hfovDegrees * Math.PI) / 360)
    return {
        fx: focalPixels / width,
        fy: focalPixels / height,
        cx: 0.5,
        cy: 0.5,
    }
}

function setStatus(message, isError) {
    statusLine.textContent = message
    statusLine.className = isError ? 'm-2 text-danger' : 'm-2 text-muted'
}

async function setup() {
    connectButton = document.getElementById('connect')
    startButton = document.getElementById('start-stream')
    stopButton = document.getElementById('stop-stream')
    deviceSelect = document.getElementById('video-device')
    statusLine = document.getElementById('status')
    detectedLine = document.getElementById('detected')
    hfovInput = document.getElementById('hfov')
    deriveButton = document.getElementById('derive')
    fxInput = document.getElementById('fx')
    fyInput = document.getElementById('fy')
    cxInput = document.getElementById('cx')
    cyInput = document.getElementById('cy')
    popNameElement = document.getElementById('pop-name')
    popJsonElement = document.getElementById('pop-json')
    measurementsList = document.getElementById('measurements')
    localVideo = document.getElementById('local-video')
    overlay = document.getElementById('local-result-overlay')
    overlayContext = overlay.getContext('2d')

    popJsonElement.textContent = JSON.stringify(handDistancePop(), undefined, 2)

    connectButton.addEventListener('click', connect)
    startButton.addEventListener('click', startStream)
    stopButton.addEventListener('click', stopStream)
    deviceSelect.addEventListener('change', probeSelectedDevice)
    deriveButton.addEventListener('click', deriveIntrinsics)
    hfovInput.addEventListener('change', deriveIntrinsics)

    await populateDevices()
}

async function populateDevices() {
    // labels are blank until the page has been granted camera access once, so
    // open a camera and release it straight away - enumerateDevices() on its
    // own would fill the selector with nameless entries
    try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true })
        probe.getTracks().forEach(track => track.stop())
    } catch (e) {
        setStatus(`No camera access: ${e.message}`, true)
        return
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    for (const device of devices) {
        if (device.kind !== 'videoinput') {
            continue
        }
        const option = document.createElement('option')
        option.value = device.deviceId
        option.text = device.label || `camera ${deviceSelect.children.length + 1}`
        deviceSelect.appendChild(option)
    }
    if (deviceSelect.children.length) {
        await probeSelectedDevice()
    } else {
        setStatus('No video input devices found.', true)
    }
}

/*
 * Open the selected camera briefly to learn what it actually produces.
 *
 * The resolution is the only thing here a browser will tell us, and it is
 * needed before the stream starts so the intrinsics can be filled in and
 * corrected by hand first.
 */
async function probeSelectedDevice() {
    const deviceId = deviceSelect.value
    if (!deviceId) {
        return
    }
    try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
        const track = probe.getVideoTracks()[0]
        probedSettings = track ? track.getSettings() : undefined
        probe.getTracks().forEach(t => t.stop())
    } catch (e) {
        setStatus(`Could not open that camera: ${e.message}`, true)
        return
    }

    if (!probedSettings || !probedSettings.width || !probedSettings.height) {
        detectedLine.textContent = 'That camera did not report a resolution, so fx and fy cannot be derived. Type them in.'
        return
    }
    const rate = probedSettings.frameRate ? ` at ${Math.round(probedSettings.frameRate)} fps` : ''
    detectedLine.textContent =
        `Reported ${probedSettings.width} x ${probedSettings.height}${rate}. ` +
        'A browser does not report focal length, so the values below are derived from the assumed field of view.'
    deriveIntrinsics()
}

function deriveIntrinsics() {
    if (!probedSettings || !probedSettings.width || !probedSettings.height) {
        return
    }
    const hfov = parseFloat(hfovInput.value)
    if (!(hfov > 0 && hfov < 180)) {
        setStatus('Field of view must be between 0 and 180 degrees.', true)
        return
    }
    const intrinsics = intrinsicsFromHfov(hfov, probedSettings.width, probedSettings.height)
    fxInput.value = intrinsics.fx.toFixed(4)
    fyInput.value = intrinsics.fy.toFixed(4)
    cxInput.value = intrinsics.cx.toFixed(4)
    cyInput.value = intrinsics.cy.toFixed(4)
}

/*
 * The calibration to send, or undefined to let the worker assume one.
 *
 * Checked here with the SDK's own validator so a bad calibration is an error
 * on this page rather than a 400 once the stream is already negotiating.
 */
function cameraFromInputs() {
    const intrinsics = {
        fx: parseFloat(fxInput.value),
        fy: parseFloat(fyInput.value),
        cx: parseFloat(cxInput.value),
        cy: parseFloat(cyInput.value),
    }
    if (!Object.values(intrinsics).every(Number.isFinite)) {
        return undefined
    }
    const camera = { intrinsics: intrinsics }
    EyePopSdk.validateCamera(camera)
    return camera
}

async function connect() {
    connectButton.disabled = true
    setStatus('Connecting...')
    try {
        if (!endpoint) {
            endpoint = await EyePop.workerEndpoint({
                auth: { oAuth2: true },
                popId: EyePopSdk.TransientPopId.Transient,
            }).onStateChanged((from, to) => {
                console.log(`Endpoint state transition from ${from} to ${to}`)
            })
            await endpoint.connect()
            await endpoint.changePop(handDistancePop())
        }
        popNameElement.textContent = endpoint.popName()
        startButton.disabled = false
        setStatus('Connected. Pick a camera and press Start.')
    } catch (e) {
        setStatus(`Connect failed: ${e.message}`, true)
        connectButton.disabled = false
    }
}

/*
 * The placed world point for each named joint of one key point group.
 *
 * A point the worker could not place carries no world members at all - sky,
 * outside the depth map, no usable depth there - rather than a zero or a NaN,
 * so testing one coordinate for a number is what separates them.
 */
function placedJoints(keyPoints) {
    const joints = new Map()
    for (const point of keyPoints.points || []) {
        if (!point || typeof point.classLabel !== 'string') {
            continue
        }
        const placed = Number.isFinite(point.worldX) && Number.isFinite(point.worldY) && Number.isFinite(point.worldZ)
        joints.set(point.classLabel, { point: point, placed: placed })
    }
    return joints
}

/*
 * One entry per person whose wrists were both detected, whether or not the
 * worker could place them.
 *
 * A detected but unplaced pair is kept deliberately: drawing it says the pose
 * was found and the depth was not, which is a different problem from the person
 * not being seen at all.
 */
function handSpans(prediction) {
    const spans = []

    const walk = (objects) => {
        for (const [index, obj] of (objects || []).entries()) {
            for (const group of obj.keyPoints || []) {
                if (group.category !== BODY_POINTS_CATEGORY) {
                    continue
                }
                const joints = placedJoints(group)
                const left = joints.get(LEFT_HAND)
                const right = joints.get(RIGHT_HAND)
                if (!left || !right) {
                    continue
                }
                const span = {
                    label: obj.classLabel ? `${obj.classLabel} ${index + 1}` : `person ${index + 1}`,
                    from: left.point,
                    to: right.point,
                    metres: undefined,
                }
                if (left.placed && right.placed) {
                    span.metres = Math.hypot(
                        right.point.worldX - left.point.worldX,
                        right.point.worldY - left.point.worldY,
                        right.point.worldZ - left.point.worldZ,
                    )
                }
                spans.push(span)
            }
            walk(obj.objects)
        }
    }
    walk(prediction.objects)
    return spans
}

function drawSpans(spans) {
    for (const span of spans) {
        const placed = span.metres !== undefined
        overlayContext.save()
        overlayContext.lineWidth = 4
        overlayContext.strokeStyle = placed ? '#00d16c' : '#ffa600'
        // dashed where the depth is missing, so a measurement is never mistaken
        // for one the worker could not actually make
        overlayContext.setLineDash(placed ? [] : [12, 10])

        overlayContext.beginPath()
        overlayContext.moveTo(span.from.x, span.from.y)
        overlayContext.lineTo(span.to.x, span.to.y)
        overlayContext.stroke()

        overlayContext.setLineDash([])
        for (const point of [span.from, span.to]) {
            overlayContext.beginPath()
            overlayContext.arc(point.x, point.y, 7, 0, 2 * Math.PI)
            overlayContext.fillStyle = placed ? '#00d16c' : '#ffa600'
            overlayContext.fill()
        }

        const text = placed ? `${span.metres.toFixed(2)} m` : 'no depth'
        const midX = (span.from.x + span.to.x) / 2
        const midY = (span.from.y + span.to.y) / 2
        overlayContext.font = 'bold 28px sans-serif'
        overlayContext.textAlign = 'center'
        overlayContext.lineWidth = 6
        overlayContext.strokeStyle = 'rgba(0, 0, 0, 0.65)'
        overlayContext.strokeText(text, midX, midY - 14)
        overlayContext.fillStyle = '#ffffff'
        overlayContext.fillText(text, midX, midY - 14)
        overlayContext.restore()
    }
}

function listSpans(spans) {
    measurementsList.replaceChildren()
    if (!spans.length) {
        const empty = document.createElement('li')
        empty.className = 'list-group-item text-muted'
        empty.textContent = 'No pose with both wrists in view.'
        measurementsList.appendChild(empty)
        return
    }
    for (const span of spans) {
        const item = document.createElement('li')
        item.className = 'list-group-item d-flex justify-content-between'
        const name = document.createElement('span')
        name.textContent = span.label
        const value = document.createElement('span')
        if (span.metres !== undefined) {
            value.textContent = `${span.metres.toFixed(2)} m`
        } else {
            value.textContent = 'wrists found, no depth to place them'
            value.className = 'text-warning'
        }
        item.append(name, value)
        measurementsList.appendChild(item)
    }
}

async function renderFromResultStream(results) {
    const poseRenderer = Render2d.renderer(overlayContext, [Render2d.renderPose()])
    for await (const result of results) {
        if (!localVideo.srcObject) {
            continue
        }
        // the overlay is stretched over the video by CSS, so drawing in the
        // frame's own coordinates needs no scaling of its own
        overlay.width = result.source_width
        overlay.height = result.source_height
        overlayContext.clearRect(0, 0, overlay.width, overlay.height)
        poseRenderer.draw(result)

        const spans = handSpans(result)
        drawSpans(spans)
        listSpans(spans)
    }
}

async function startStream() {
    startButton.disabled = true
    let camera
    try {
        camera = cameraFromInputs()
    } catch (e) {
        setStatus(`Calibration rejected: ${e.message}`, true)
        startButton.disabled = false
        return
    }
    if (!camera) {
        setStatus('No calibration, so the worker assumes a 60 degree field of view.')
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceSelect.value } },
        })
        localVideo.srcObject = stream
        await localVideo.play()

        resultStream = await endpoint.process({ source: { mediaStream: stream }, camera: camera })
        stopButton.disabled = false
        setStatus('Measuring. Hold both wrists in view.')
        renderFromResultStream(resultStream)
            .catch(e => setStatus(`Result stream ended: ${e.message}`, true))
            .finally(() => console.log('result stream finished'))
    } catch (e) {
        setStatus(`Could not start: ${e.message}`, true)
        startButton.disabled = false
    }
}

async function stopStream() {
    stopButton.disabled = true
    if (resultStream) {
        resultStream.cancel()
        resultStream = undefined
    }
    localVideo.pause()
    if (localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach(track => track.stop())
        localVideo.srcObject = null
    }
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)
    startButton.disabled = false
    setStatus('Stopped.')
}

document.addEventListener('DOMContentLoaded', setup)
