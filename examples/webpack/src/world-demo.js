/*
 * World coordinates in the browser, from a webcam or from a dropped file.
 *
 * Three Pops share one page: the scene's own point cloud, back-projected from
 * nothing but a depth map; per-person clouds cut out of a segmentation mask;
 * and the distance between a person's hands, measured through that same map.
 * The wrists are the hands there: the 2D body model has no hand point of its
 * own, and a wrist is the closest joint it does place.
 *
 * A source is either a live webcam or a file dropped on the preview. The same
 * Pop, the same overlay and the same 3D view serve both - a still is a video of
 * one frame as far as everything downstream of process() is concerned.
 */
import { EyePop, ForwardOperatorType, PopComponentType, cloudOfDepth, cloudOfObject, validateCamera } from '@eyepop.ai/eyepop'
import { POSE_CONNECTIONS, Render2d } from '@eyepop.ai/eyepop-render-2d'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// The body model's own labels for the two joints, matched by label rather than
// index: the label is what identifies a joint, and a model emitting its points
// in another order would otherwise be measured between the wrong two.
const LEFT_HAND = 'left wrist'
const RIGHT_HAND = 'right wrist'

const BODY_POINTS_CATEGORY = '2d-body-points'

// Metric: a 'relative' depth ability is accepted by the worker and silently
// yields no world coordinates at all, because relative depth is scale- AND
// shift-invariant, so a distance recovered from one would be distorted rather
// than merely unscaled.
//
// The landscape variant because a webcam frame is wide, and these fit that
// aspect rather than paying for a square map to cover it.
const DEPTH_ABILITY = 'eyepop.depth.metric.small-landscape:latest'

/*
 * The map read back as the scene cloud is read at its own resolution, so the
 * ability's grid *is* the resolution of the result: 924x518 for the large
 * landscape variant against 504x280 for the small one, a cloud three times as
 * dense over the same frame. It is affordable there because nothing else in
 * that Pop runs - no encoder, no detector, no segmenter.
 */
const SCENE_DEPTH_ABILITY = 'eyepop.depth.metric.large-landscape:latest'

let endpoint = undefined
let resultStream = undefined
let probedSettings = undefined

// The webcam, not the endpoint: true only while a MediaStream is being
// processed, which is what the drop target and the two webcam controls key off.
let streaming = false

// The file currently loaded into the preview, kept so a change of feature or of
// calibration can run it again rather than asking for it to be dropped twice.
let loadedFile = undefined
let previewUrl = undefined

let connectButton, connectSpinner, connectLabel, webcamSelect, disconnectButton, statusLine
let detectedLine, hfovInput, deriveButton, fxInput, fyInput, cxInput, cyInput
let extrinsicsSwitch, yawInput, tiltInput, heightInput, quaternionField, worldFrameNote
let popJsonElement, measurementsList, erodeInput
let localVideo, localImage, overlay, overlayContext
let previewWrapper, previewFrame, dropHint, dropHintTitle, dropHintNote, fileInput, previewNote
let previewFullscreen, worldFullscreen, worldContainer
let overlayRenderer

// One colour per series, so the carriers stay apart in the 3D view the way one
// legend entry per carrier does in a plot.
const SERIES_COLOURS = [
    0xe41a1c, 0x377eb8, 0x4daf4a, 0x984ea3, 0xff7f00, 0xa65628, 0xf781bf,
]

/*
 * Preallocated capacity for the 3D view.
 *
 * The buffers are written in place and the draw range moved, rather than
 * rebuilt per frame: a new BufferGeometry every frame at 30fps is what turns a
 * point cloud viewer into a garbage collector. A Pop returning scene clouds
 * needs the larger number - one point per depth map pixel - even though this
 * one returns only skeletons.
 */
// Point diameter in meters, since sizeAttenuation is on: a point is a fixed
// size in the scene rather than on screen, so it shrinks with distance like
// everything else.
//
// Two sizes because the carriers are two different things. A skeleton is a
// handful of joints and wants to be seen; a mask or scene cloud is one point
// per pixel, and at the sparse size those merge into a solid block that hides
// whatever is behind it.
const SPARSE_POINT_SIZE_METERS = 0.06
const CLOUD_POINT_SIZE_METERS = 0.005

// How much lighter a cloud is drawn than its series colour.
//
// A 5 mm point covers a handful of pixels, and against the dark ground a small
// patch of a colour reads dimmer than a line or a fat point of the same one.
// Lifting the lightness keeps the hue - so a cloud still matches the carrier it
// belongs to - rather than keeping a second palette in step with the first.
const CLOUD_LIGHTEN = 0.2

const MAX_SPARSE_POINTS = 20000
// one point per pixel of the largest map this page asks for - 924 x 518 is
// 478,632 - and a little over, so the scene cloud arrives whole rather than
// clipped at a capacity chosen for a smaller one
const MAX_CLOUD_POINTS = 520000
const MAX_SEGMENTS = 60000

// The three Pops this page offers, in the order the radios list them. Values
// rather than labels, because the value is what the Pop is chosen by.
const FEATURES = {
    scene: 'point cloud',
    person: 'person point cloud',
    hands: 'hand distance',
}

// The body points branch: it is what the hand distance is measured from and
// what draws a skeleton in the 3D tab.
function bodyPointsComponent() {
    return {
        type: PopComponentType.INFERENCE,
        model: 'eyepop.person.2d-body-points:latest',
        categoryName: BODY_POINTS_CATEGORY,
        confidenceThreshold: 0.25,
        // this is the component whose points get back-projected; the person box
        // above has no points to place
        toWorld: true,
    }
}

/*
 * A segmenter beside the body points, its mask split into pieces.
 *
 * toWorld sits on the segmenter rather than on the component finder: only a
 * component that runs its own inference can carry it, which is what gives it an
 * id for the worker to select on. The pieces inherit the placement from the
 * mask they were cut out of.
 */
function segmentationComponent(erode) {
    const decoder = {
        type: PopComponentType.INFERENCE,
        model: 'eyepop.sam2.decoder:latest',
        toWorld: true,
    }
    // At zero the finder has nothing to do, and asking for a split that erodes
    // by nothing is not the same as not splitting: it still cuts the mask into
    // whatever pieces touch only at a pixel. Leaving it out keeps the mask
    // whole, which is the honest reading of an erode of none.
    if (!(erode > 0)) {
        return decoder
    }
    decoder.forward = {
        operator: { type: ForwardOperatorType.FULL },
        targets: [
            {
                type: PopComponentType.COMPONENT_FINDER,
                erode: erode,
            },
        ],
    }
    return decoder
}

function personComponent(targets) {
    return {
        type: PopComponentType.INFERENCE,
        model: 'eyepop.person:latest',
        categoryName: 'person',
        forward: {
            operator: {
                type: ForwardOperatorType.CROP,
                crop: { maxItems: 16 },
            },
            targets: targets,
        },
    }
}

function popForFeature(feature, erode) {
    /*
     * The scene's own cloud: a depth map asking for toWorld, and nothing else.
     *
     * A Pop like this is complete - no component has to opt in, because the
     * thing being back-projected is the map rather than any prediction made
     * through it. toWorld is also what reveals the map, so the response carries
     * depth.values as well as depth.world and the video tab can draw it.
     */
    if (feature === 'scene') {
        return { components: [], depthMap: { ability: SCENE_DEPTH_ABILITY, toWorld: true } }
    }

    // named but not revealed: without toWorld the worker keeps the depth branch
    // out of the response, which on a live stream is the difference between a
    // few key points and a megabyte of base64 per frame
    const depthMap = { ability: DEPTH_ABILITY }

    if (feature !== 'person') {
        return { components: [personComponent([bodyPointsComponent()])], depthMap: depthMap }
    }

    /*
     * SAM2 comes apart into an encoder and a decoder, and the encoder has to
     * see the whole frame before anything has been detected in it. So it is the
     * outermost component and the detector hangs off its forward, rather than
     * sitting beside the detector the way a one-shot segmenter did.
     *
     * Hidden, because an embedding is not a prediction anyone wants back. A
     * hidden component's forward targets are still walked, which is what makes
     * the arrangement work.
     */
    return {
        components: [
            {
                type: PopComponentType.INFERENCE,
                model: 'eyepop.sam2.encoder.tiny:latest',
                hidden: true,
                forward: {
                    targets: [personComponent([segmentationComponent(erode)])],
                },
            },
        ],
        depthMap: depthMap,
    }
}

function selectedFeature() {
    return document.querySelector('input[name="feature"]:checked')?.value ?? 'scene'
}

function currentPop() {
    const erode = parseFloat(erodeInput.value)
    return popForFeature(selectedFeature(), Number.isFinite(erode) ? erode : undefined)
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

/*
 * The camera-to-world rotation for a yaw and a downward tilt.
 *
 * With both zero the camera looks along world +Y with Z up, which is R_x(-90):
 * camera +Z (forward) lands on world +Y, and camera +Y (down) on world -Z. A
 * tilt turns it further down and a yaw turns it about the world's up axis, so
 * R = R_z(yaw) . R_x(theta) with theta = -(90 + tilt).
 *
 * Composed as quaternions rather than matrices because a quaternion is what the
 * contract takes, and going through a matrix would only add a conversion to get
 * wrong.
 */
function rotationFromYawTilt(yawDegrees, tiltDegrees) {
    const psi = (yawDegrees * Math.PI) / 180
    const theta = (-(90 + tiltDegrees) * Math.PI) / 180
    const cosPsi = Math.cos(psi / 2)
    const sinPsi = Math.sin(psi / 2)
    const cosTheta = Math.cos(theta / 2)
    const sinTheta = Math.sin(theta / 2)
    return {
        w: cosPsi * cosTheta,
        x: cosPsi * sinTheta,
        y: sinPsi * sinTheta,
        z: sinPsi * cosTheta,
    }
}

/*
 * The pose to send, or undefined for none.
 *
 * Translation is where the camera itself sits, not solvePnP's tvec: a camera
 * declared 1.2 m up reports its scene 1.2 m up.
 */
function extrinsicsFromInputs() {
    if (!extrinsicsSwitch.checked) {
        return undefined
    }
    const yaw = parseFloat(yawInput.value)
    const tilt = parseFloat(tiltInput.value)
    const height = parseFloat(heightInput.value)
    if (![yaw, tilt, height].every(Number.isFinite)) {
        return undefined
    }
    return {
        rotation: rotationFromYawTilt(yaw, tilt),
        translation: { x: 0, y: 0, z: height },
    }
}

function showQuaternion() {
    const extrinsics = extrinsicsFromInputs()
    if (!extrinsics) {
        quaternionField.value = ''
        return
    }
    const q = extrinsics.rotation
    quaternionField.value = `${q.w.toFixed(4)}, ${q.x.toFixed(4)}, ${q.y.toFixed(4)}, ${q.z.toFixed(4)}`
}

function updateExtrinsicsEnabled() {
    const on = extrinsicsSwitch.checked
    for (const field of [yawInput, tiltInput, heightInput, quaternionField]) {
        field.disabled = !on
    }
    showQuaternion()
}

// half the default distance, so the scene starts twice as large as the framing
// that fits it - a person is a small object in a room sized grid
const DEFAULT_ZOOM = 2
const DEFAULT_TARGET = new THREE.Vector3(0, 1.5, 0)
const DEFAULT_OFFSET = new THREE.Vector3(2.5, -5.0, 2.0)

function setStatus(message, isError) {
    statusLine.textContent = message
    statusLine.className = isError ? 'm-2 text-danger' : 'm-2 text-muted'
}

async function setup() {
    connectButton = document.getElementById('connect')
    connectSpinner = document.getElementById('connect-spinner')
    connectLabel = document.getElementById('connect-label')
    webcamSelect = document.getElementById('webcam-select')
    disconnectButton = document.getElementById('webcam-disconnect')
    statusLine = document.getElementById('status')
    detectedLine = document.getElementById('detected')
    hfovInput = document.getElementById('hfov')
    deriveButton = document.getElementById('derive')
    fxInput = document.getElementById('fx')
    fyInput = document.getElementById('fy')
    cxInput = document.getElementById('cx')
    cyInput = document.getElementById('cy')
    popJsonElement = document.getElementById('pop-json')
    measurementsList = document.getElementById('measurements')
    extrinsicsSwitch = document.getElementById('extrinsics-on')
    yawInput = document.getElementById('yaw')
    tiltInput = document.getElementById('tilt')
    heightInput = document.getElementById('height')
    quaternionField = document.getElementById('quaternion')
    worldFrameNote = document.getElementById('world-frame-note')
    localVideo = document.getElementById('local-video')
    localImage = document.getElementById('local-image')
    overlay = document.getElementById('local-result-overlay')
    overlayContext = overlay.getContext('2d')
    previewWrapper = document.getElementById('preview')
    previewFrame = document.getElementById('preview-frame')
    previewFullscreen = document.getElementById('preview-fullscreen')
    worldFullscreen = document.getElementById('world-fullscreen')
    worldContainer = document.getElementById('world-canvas')
    dropHint = document.getElementById('drop-hint')
    dropHintTitle = document.getElementById('drop-hint-title')
    dropHintNote = document.getElementById('drop-hint-note')
    fileInput = document.getElementById('file-input')
    previewNote = document.getElementById('preview-note')

    erodeInput = document.getElementById('erode')

    // renderDepth draws nothing unless the prediction carries a depth map, and
    // only the scene Pop reveals one, so one renderer serves all three features
    // rather than a set rebuilt whenever the feature changes
    overlayRenderer = Render2d.renderer(overlayContext, [Render2d.renderPose(), Render2d.renderDepth({ opacity: 0.45 })])

    connectButton.addEventListener('click', toggleConnection)
    webcamSelect.addEventListener('change', connectWebcam)
    disconnectButton.addEventListener('click', disconnectWebcam)
    deriveButton.addEventListener('click', () => deriveIntrinsics(true))
    hfovInput.addEventListener('change', () => deriveIntrinsics(true))
    extrinsicsSwitch.addEventListener('change', updateExtrinsicsEnabled)
    for (const field of [yawInput, tiltInput, heightInput]) {
        field.addEventListener('change', showQuaternion)
    }
    // a calibration only reaches the worker with a source, so changing one is
    // only visible on the next run: a loaded file is simply run again
    for (const field of [hfovInput, fxInput, fyInput, cxInput, cyInput, yawInput, tiltInput, heightInput, extrinsicsSwitch]) {
        field.addEventListener('change', reprocessLoadedFile)
    }
    for (const button of document.querySelectorAll('#view-tabs .nav-link')) {
        button.addEventListener('click', () => showView(button.dataset.view))
    }
    for (const header of document.querySelectorAll('.section-header')) {
        header.addEventListener('click', () => toggleSection(header))
    }
    for (const radio of document.querySelectorAll('input[name="feature"]')) {
        radio.addEventListener('change', applyFeature)
    }
    erodeInput.addEventListener('change', applyFeature)
    document.getElementById('reset-view').addEventListener('click', resetWorldView)

    setupDropTarget()
    setupFullscreen()
    setupWorldView(worldContainer)
    showView('video')
    await applyFeature()
    updateExtrinsicsEnabled()
    describeWorldFrame(undefined)
    updateSourceControls()

    showConnectButton(false)
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
        setStatus(`No camera access: ${e.message}. Drop a file on the preview instead.`, true)
        return
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    let cameras = 0
    for (const device of devices) {
        if (device.kind !== 'videoinput') {
            continue
        }
        cameras += 1
        const option = document.createElement('option')
        option.value = device.deviceId
        option.text = device.label || `camera ${cameras}`
        webcamSelect.appendChild(option)
    }
    if (!cameras) {
        setStatus('No video input devices found. Drop a file on the preview instead.', true)
        return
    }
    // the first camera's resolution, so the calibration panel says something
    // before any camera has been chosen; the selector stays on its placeholder
    await probeDevice(webcamSelect.children[1].value)
    updateSourceControls()
}

/*
 * Open a camera briefly to learn what it actually produces.
 *
 * The resolution is the only thing here a browser will tell us, and it is what
 * the intrinsics are derived from. Done before the stream rather than from the
 * stream's own track so a calibration typed by hand survives a reconnect.
 */
async function probeDevice(deviceId) {
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
        detectedLine.textContent =
            'That camera did not report a resolution, so fx and fy cannot be derived. Type them in.'
        return
    }
    const rate = probedSettings.frameRate ? ` at ${Math.round(probedSettings.frameRate)} fps` : ''
    describeSource(
        `Camera reported ${probedSettings.width} x ${probedSettings.height}${rate}. ` +
            'A browser does not report focal length, so the values below are derived from the assumed field of view.',
    )
}

// What the calibration panel was last derived from, named so a dropped file can
// replace a camera's numbers and a camera's can replace a file's.
function describeSource(text) {
    detectedLine.textContent = text
    deriveIntrinsics(false)
}

/*
 * The last set of values this page computed, so a hand correction is not undone
 * by the next source that reports a resolution.
 *
 * Compared as the strings in the inputs rather than as numbers: those are what
 * was written, and a value the user retyped identically is one this page is
 * still free to replace.
 */
let derivedIntrinsics = undefined

function intrinsicsWereDerived() {
    if (!derivedIntrinsics) {
        return true
    }
    return [fxInput, fyInput, cxInput, cyInput].every((field, index) => field.value === derivedIntrinsics[index])
}

function deriveIntrinsics(force) {
    if (!probedSettings || !probedSettings.width || !probedSettings.height) {
        return
    }
    const hfov = parseFloat(hfovInput.value)
    if (!(hfov > 0 && hfov < 180)) {
        setStatus('Field of view must be between 0 and 180 degrees.', true)
        return
    }
    // a source change recomputes only what this page put there; the derive
    // button and the field of view are asked for explicitly and always win
    if (!force && !intrinsicsWereDerived()) {
        return
    }
    const intrinsics = intrinsicsFromHfov(hfov, probedSettings.width, probedSettings.height)
    fxInput.value = intrinsics.fx.toFixed(4)
    fyInput.value = intrinsics.fy.toFixed(4)
    cxInput.value = intrinsics.cx.toFixed(4)
    cyInput.value = intrinsics.cy.toFixed(4)
    derivedIntrinsics = [fxInput.value, fyInput.value, cxInput.value, cyInput.value]
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
    const extrinsics = extrinsicsFromInputs()
    const camera = extrinsics ? { intrinsics: intrinsics, extrinsics: extrinsics } : { intrinsics: intrinsics }
    validateCamera(camera)
    return camera
}

/*
 * The button's own state, in the button.
 *
 * It is the session's one control, so it says what it will do rather than what
 * has happened: Connect while there is none, Disconnect while there is. Opening
 * one takes seconds and disables everything it unlocks, so a spinner in the
 * label says which of the two it is without a second place to look.
 */
function showConnectButton(busy, busyLabel) {
    connectSpinner.hidden = !busy
    connectButton.setAttribute('aria-busy', busy ? 'true' : 'false')
    connectButton.disabled = Boolean(busy)
    connectLabel.textContent = busy ? busyLabel : endpoint ? 'Disconnect' : 'Connect'
}

function toggleConnection() {
    return endpoint ? disconnect() : connect()
}

// What a source leaves behind, cleared when there is no longer a source that
// could have produced it.
function resetResults() {
    measurementsList.replaceChildren()
    const empty = document.createElement('li')
    empty.className = 'list-group-item text-muted'
    empty.textContent = 'Nothing yet.'
    measurementsList.appendChild(empty)
    updateWorldView([])
    describeWorldFrame(undefined)
}

async function connect() {
    if (endpoint) {
        return
    }
    showConnectButton(true, 'Connecting...')
    setStatus('Connecting...')
    try {
        // minted by webpack.config.js at build time from EYEPOP_API_KEY and
        // emitted as an asset: the key stays on the build host, and only the
        // short lived session reaches the browser
        const session = await (await fetch('eyepop-session.json')).json()
        endpoint = await EyePop.workerEndpoint({ auth: { session: session } }).onStateChanged((from, to) => {
            console.log(`Endpoint state transition from ${from} to ${to}`)
        })
        await endpoint.connect()
        await endpoint.changePop(currentPop())
        setStatus('Connected. Pick a camera, or drop an image or a video on the preview.')
    } catch (e) {
        // dropped rather than kept: a half opened endpoint would leave the drop
        // target and the camera selector enabled over a session that is not there
        endpoint = undefined
        setStatus(`Connect failed: ${e.message}`, true)
    } finally {
        showConnectButton(false)
        updateSourceControls()
    }
}

/*
 * Give the session back, and everything that was running on it.
 *
 * The endpoint is dropped before the await rather than after: a disconnect is
 * not instant, and until it is done nothing should be able to start a camera or
 * a file against a session already on its way out.
 */
async function disconnect() {
    const closing = endpoint
    if (!closing) {
        return
    }
    endpoint = undefined
    streaming = false
    sourceToken += 1
    cancelResultStream()
    stopPlayback()
    loadedFile = undefined
    clearPreview()
    resetResults()
    webcamSelect.value = ''
    showConnectButton(true, 'Disconnecting...')
    updateSourceControls()
    setStatus('Disconnecting...')
    try {
        await closing.disconnect()
        setStatus('Disconnected. Press Connect for a new session.')
    } catch (e) {
        setStatus(`Disconnect failed: ${e.message}`, true)
    } finally {
        showConnectButton(false)
        updateSourceControls()
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

    const walk = objects => {
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
                    meters: undefined,
                }
                if (left.placed && right.placed) {
                    span.meters = Math.hypot(
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
        const placed = span.meters !== undefined
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

        const text = placed ? `${span.meters.toFixed(2)} m` : 'no depth'
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
        if (span.meters !== undefined) {
            value.textContent = `${span.meters.toFixed(2)} m`
        } else {
            value.textContent = 'wrists found, no depth to place them'
            value.className = 'text-warning'
        }
        item.append(name, value)
        measurementsList.appendChild(item)
    }
}

/*
 * What a cloud feature has to report: how much of the frame the worker managed
 * to place, per carrier.
 *
 * A distance is the measurement when there are wrists to measure between. With
 * nothing but clouds the honest equivalent is the count - an empty list and a
 * list of half a million points are the two outcomes worth telling apart, and
 * neither is visible in the video tab.
 */
function listSeries(series) {
    measurementsList.replaceChildren()
    if (!series.length) {
        const empty = document.createElement('li')
        empty.className = 'list-group-item text-muted'
        empty.textContent = 'Nothing placed yet.'
        measurementsList.appendChild(empty)
        return
    }
    for (const entry of series) {
        const item = document.createElement('li')
        item.className = 'list-group-item d-flex justify-content-between'
        const name = document.createElement('span')
        name.textContent = entry.label
        const value = document.createElement('span')
        value.textContent = `${entry.points.length.toLocaleString()} points`
        item.append(name, value)
        measurementsList.appendChild(item)
    }
}

function listMeasurements(spans, series) {
    if (selectedFeature() === 'hands') {
        listSpans(spans)
        return
    }
    listSeries(series)
}

/*
 * Every set of world coordinates in a prediction, labelled and connected.
 *
 * Key points, outlines, contours with their cutouts, mask clouds and the scene
 * cloud alike, so the 3D view fills for any Pop rather than only this one.
 * Segments index into the series' own points.
 */
function labelledWorldPoints(prediction) {
    const series = []
    const seen = new Map()

    const placedPoints = points => {
        const placed = []
        const indexOf = []
        for (const point of points || []) {
            if (Number.isFinite(point?.worldX) && Number.isFinite(point?.worldY) && Number.isFinite(point?.worldZ)) {
                indexOf.push(placed.length)
                placed.push({ x: point.worldX, y: point.worldY, z: point.worldZ })
            } else {
                indexOf.push(-1)
            }
        }
        return { points: placed, indexOf: indexOf }
    }

    const cloudPoints = cloud => {
        const placed = []
        for (let offset = 0; offset + 2 < cloud.points.length; offset += 3) {
            const x = cloud.points[offset]
            const y = cloud.points[offset + 1]
            const z = cloud.points[offset + 2]
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                placed.push({ x: x, y: y, z: z })
            }
        }
        return placed
    }

    // a ring in the order the worker emitted it. A pair with an unplaced point
    // in it is skipped rather than bridged: an edge across the gap would be a
    // line the geometry does not have
    const pathSegments = placed => {
        const segments = []
        const count = placed.indexOf.length
        if (count < 2) {
            return segments
        }
        for (let i = 0; i < count; i++) {
            const from = placed.indexOf[i]
            const to = placed.indexOf[(i + 1) % count]
            if (from >= 0 && to >= 0) {
                segments.push([from, to])
            }
        }
        return segments
    }

    // matched by class label, using the 2D renderer's own table, so one
    // skeleton is not drawn two different ways
    const poseSegments = (group, placed) => {
        const connections = typeof group?.category === 'string' ? POSE_CONNECTIONS[group.category] : undefined
        if (!connections) {
            return []
        }
        const byLabel = new Map()
        ;(group?.points || []).forEach((point, i) => {
            const index = placed.indexOf[i] ?? -1
            if (index >= 0 && typeof point?.classLabel === 'string') {
                byLabel.set(point.classLabel, index)
            }
        })
        const segments = []
        for (const connection of connections) {
            const from = byLabel.get(connection[0])
            const to = byLabel.get(connection[1])
            if (from !== undefined && to !== undefined) {
                segments.push([from, to])
            }
        }
        return segments
    }

    // dense marks the one-point-per-pixel carriers - a mask or the scene - which
    // are drawn with the small points and never carry segments
    const add = (label, points, segments, dense = false) => {
        if (points.length) {
            series.push({ label: label, points: points, segments: segments, dense: dense })
        }
    }

    const walk = objects => {
        for (const [index, obj] of (objects || []).entries()) {
            let name = obj?.classLabel ?? `object ${index}`
            const count = (seen.get(name) ?? 0) + 1
            seen.set(name, count)
            if (count > 1) {
                name = `${name} ${count}`
            }

            for (const group of obj?.keyPoints || []) {
                const placed = placedPoints(group?.points)
                add(`${name} keypoints`, placed.points, poseSegments(group, placed))
            }
            const outline = placedPoints(obj?.outline)
            add(`${name} outline`, outline.points, pathSegments(outline))
            for (const contour of obj?.contours || []) {
                const points = placedPoints(contour?.points)
                add(`${name} contour`, points.points, pathSegments(points))
                for (const cutout of contour?.cutouts || []) {
                    const hole = placedPoints(cutout)
                    add(`${name} cutout`, hole.points, pathSegments(hole))
                }
            }
            const cloud = cloudOfObject(obj)
            if (cloud !== undefined) {
                add(`${name} mask`, cloudPoints(cloud), [], true)
            }

            walk(obj?.objects)
        }
    }

    for (const group of prediction?.keyPoints || []) {
        const placed = placedPoints(group?.points)
        add('keypoints', placed.points, poseSegments(group, placed))
    }
    walk(prediction?.objects)

    // last, so the objects a viewer came to look at are not buried under a
    // cloud two orders of magnitude larger
    const scene = cloudOfDepth(prediction?.depth, prediction?.source_width, prediction?.source_height)
    if (scene !== undefined) {
        add('scene', cloudPoints(scene), [], true)
    }
    return series
}

/*
 * The 3D view: a Z-up coordinate system, orbit controls, one Points object and
 * one LineSegments object whose buffers are rewritten in place.
 */
const world = {
    renderer: undefined,
    scene: undefined,
    camera: undefined,
    controls: undefined,
    sparse: undefined,
    cloud: undefined,
    lines: undefined,
    linePositions: undefined,
    lineColours: undefined,
    visible: false,
}

// The framing the view opens with, and the way back to it. Losing the scene
// behind you is easy and there is no other route back short of a reload.
function resetWorldView() {
    if (!world.camera || !world.controls) {
        return
    }
    world.camera.position.copy(DEFAULT_TARGET).addScaledVector(DEFAULT_OFFSET, 1 / DEFAULT_ZOOM)
    world.controls.target.copy(DEFAULT_TARGET)
    world.controls.update()
}

function makePoints(size, capacity) {
    const positions = new Float32Array(capacity * 3)
    const colours = new Float32Array(capacity * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    geometry.setDrawRange(0, 0)
    const object = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: size, vertexColors: true, sizeAttenuation: true }),
    )
    return { object: object, positions: positions, colours: colours, capacity: capacity, count: 0 }
}

function setupWorldView(container) {
    world.renderer = new THREE.WebGLRenderer({ antialias: true })
    world.renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(world.renderer.domElement)

    world.scene = new THREE.Scene()
    world.scene.background = new THREE.Color(0x101418)
    /*
     * Distance fog, rather than a light.
     *
     * PointsMaterial and LineBasicMaterial are unlit - they ignore every light
     * in the scene - so a lamp here would change nothing. What does read as
     * depth is fog: points fade into the background colour as they recede, and
     * the shader does it for free. Together with sizeAttenuation, which already
     * shrinks a point with distance, that is the pair of cues a photograph has.
     */
    world.scene.fog = new THREE.Fog(0x101418, 0.5, 10)

    world.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500)
    // three.js is Y-up by default and the EyePop world frame is Z-up, so the
    // camera's up axis is set before the controls read it - otherwise orbiting
    // rolls the scene onto its side
    world.camera.up.set(0, 0, 1)
    world.controls = new OrbitControls(world.camera, world.renderer.domElement)
    world.controls.enableDamping = true
    // three wires the arrow keys to panning but listens for them nowhere unless
    // told to. Bound to the container rather than the window so the view has to
    // be focused first, which is why it carries a tabindex: arrow keys that
    // scroll the page one moment and move a camera the next are worse than
    // arrow keys that do nothing.
    world.controls.listenToKeyEvents(container)
    resetWorldView()

    world.scene.add(new THREE.AxesHelper(1))
    const grid = new THREE.GridHelper(10, 20, 0x445566, 0x223344)
    // the helper lies in XZ; a quarter turn about X puts it on the ground plane
    grid.rotation.x = Math.PI / 2
    world.scene.add(grid)

    world.sparse = makePoints(SPARSE_POINT_SIZE_METERS, MAX_SPARSE_POINTS)
    world.cloud = makePoints(CLOUD_POINT_SIZE_METERS, MAX_CLOUD_POINTS)
    world.scene.add(world.sparse.object, world.cloud.object)

    world.linePositions = new Float32Array(MAX_SEGMENTS * 2 * 3)
    world.lineColours = new Float32Array(MAX_SEGMENTS * 2 * 3)
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(world.linePositions, 3))
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(world.lineColours, 3))
    lineGeometry.setDrawRange(0, 0)
    world.lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true }))
    world.scene.add(world.lines)

    const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (!width || !height) {
            return
        }
        // updateStyle false: the drawing buffer is sized in device pixels and
        // the stylesheet stretches the canvas over its box, so a high DPR
        // display does not push a canvas wider than the container it sits in
        world.renderer.setSize(width, height, false)
        world.camera.aspect = width / height
        world.camera.updateProjectionMatrix()
    }
    new ResizeObserver(resize).observe(container)
    resize()

    const frame = () => {
        requestAnimationFrame(frame)
        // orbiting still has to settle while the tab is hidden, but there is
        // nothing to draw into a container of zero size
        world.controls.update()
        if (world.visible) {
            world.renderer.render(world.scene, world.camera)
        }
    }
    frame()
}

function updateWorldView(series) {
    if (!world.sparse) {
        return
    }
    const colour = new THREE.Color()
    world.sparse.count = 0
    world.cloud.count = 0
    let vertexCount = 0

    const push = (target, point) => {
        if (target.count >= target.capacity) {
            return false
        }
        const at = target.count * 3
        target.positions[at] = point.x
        target.positions[at + 1] = point.y
        target.positions[at + 2] = point.z
        target.colours[at] = colour.r
        target.colours[at + 1] = colour.g
        target.colours[at + 2] = colour.b
        target.count += 1
        return true
    }

    series.forEach((entry, index) => {
        colour.setHex(SERIES_COLOURS[index % SERIES_COLOURS.length])
        if (entry.dense) {
            colour.offsetHSL(0, 0, CLOUD_LIGHTEN)
        }
        // a dense carrier goes in the small-point buffer; the segments below can
        // only reference the sparse one, which is the buffer the carriers that
        // have segments write into
        const target = entry.dense ? world.cloud : world.sparse
        const base = target.count
        for (const point of entry.points) {
            if (!push(target, point)) {
                break
            }
        }
        if (entry.dense) {
            return
        }
        for (const segment of entry.segments) {
            if (vertexCount + 2 > MAX_SEGMENTS * 2) {
                break
            }
            for (const end of segment) {
                const from = (base + end) * 3
                const at = vertexCount * 3
                world.linePositions[at] = world.sparse.positions[from]
                world.linePositions[at + 1] = world.sparse.positions[from + 1]
                world.linePositions[at + 2] = world.sparse.positions[from + 2]
                world.lineColours[at] = colour.r
                world.lineColours[at + 1] = colour.g
                world.lineColours[at + 2] = colour.b
                vertexCount += 1
            }
        }
    })

    for (const target of [world.sparse, world.cloud]) {
        target.object.geometry.setDrawRange(0, target.count)
        target.object.geometry.attributes.position.needsUpdate = true
        target.object.geometry.attributes.color.needsUpdate = true
    }
    world.lines.geometry.setDrawRange(0, vertexCount)
    world.lines.geometry.attributes.position.needsUpdate = true
    world.lines.geometry.attributes.color.needsUpdate = true
}

/*
 * Show the Pop the selection describes, and hand it to the worker if one is
 * already connected.
 *
 * changePop is how a Pop is meant to be swapped on a running pipeline, so the
 * feature can be changed mid-stream rather than only before Start.
 */
async function applyFeature() {
    const feature = selectedFeature()
    // the other two Pops have no mask for a component finder to cut up, so
    // there is nothing for an erode to shrink
    erodeInput.disabled = feature !== 'person'
    const pop = currentPop()
    popJsonElement.textContent = JSON.stringify(pop, undefined, 2)
    if (!endpoint) {
        return
    }
    try {
        await endpoint.changePop(pop)
        setStatus(`Pop set to ${FEATURES[feature] ?? feature}.`)
    } catch (e) {
        setStatus(`Could not change the pop: ${e.message}`, true)
        return
    }
    // a live stream picks the new Pop up on its next frame; a still has no next
    // frame, so it is run again
    await reprocessLoadedFile()
}

function toggleSection(header) {
    const body = document.getElementById(`section-${header.dataset.section}`)
    body.hidden = !body.hidden
    header.classList.toggle('open', !body.hidden)
}

function showView(name) {
    document.getElementById('view-video').hidden = name !== 'video'
    document.getElementById('view-world').hidden = name !== 'world'
    for (const button of document.querySelectorAll('#view-tabs .nav-link')) {
        button.classList.toggle('active', button.dataset.view === name)
    }
    world.visible = name === 'world'
}

/*
 * Everything one prediction changes on the page.
 *
 * Shared by the webcam and by a dropped file, because the overlay, the
 * measurements and the 3D view are downstream of a prediction alone and know
 * nothing about where it came from.
 */
function drawPrediction(result) {
    // the overlay is stretched over the media by CSS, so drawing in the frame's
    // own coordinates needs no scaling of its own
    overlay.width = result.source_width
    overlay.height = result.source_height
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)
    overlayRenderer.draw(result)

    const spans = handSpans(result)
    drawSpans(spans)
    const series = labelledWorldPoints(result)
    listMeasurements(spans, series)
    updateWorldView(series)
}

async function renderFromResultStream(results) {
    for await (const result of results) {
        if (!localVideo.srcObject) {
            continue
        }
        drawPrediction(result)
    }
}

/*
 * Say which frame the 3D tab is drawing.
 *
 * Nothing in a prediction records it, so the only honest source is what this
 * page sent: with a pose the points are in the world frame, without one they
 * are in the camera's.
 */
function describeWorldFrame(camera) {
    if (!camera) {
        worldFrameNote.textContent = 'No source processed yet.'
        return
    }
    worldFrameNote.textContent = camera.extrinsics
        ? 'World frame: Z up, ground at Z = 0, the camera placed by the pose above.'
        : 'Camera frame: X right, Y down, Z forward, origin at the lens. Turn on extrinsics for a world frame.'
}

/*
 * Give the preview back whatever it is holding.
 *
 * One function for a camera and a file alike: getUserMedia() can succeed and
 * everything after it still fail, and an object URL left unrevoked holds the
 * whole file in memory, so both are released on every path that replaces a
 * source rather than only on the one that looks like a stop.
 */
function clearPreview() {
    localVideo.pause()
    if (localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach(track => track.stop())
        localVideo.srcObject = null
    }
    if (localVideo.getAttribute('src')) {
        localVideo.removeAttribute('src')
        // without a reload the element keeps showing the frame it last decoded
        localVideo.load()
    }
    localImage.removeAttribute('src')
    localImage.hidden = true
    // hidden rather than left empty: a <video> with no source still occupies its
    // 300x150 default, drawing a bordered box across the middle of the drop area
    localVideo.hidden = true
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        previewUrl = undefined
    }
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)
}

function cancelResultStream() {
    if (resultStream) {
        resultStream.cancel()
        resultStream = undefined
    }
}

function hasPreviewMedia() {
    return Boolean(localVideo.srcObject || localVideo.getAttribute('src') || localImage.getAttribute('src'))
}

/*
 * Whether the preview will take a file.
 *
 * A session, because there is nowhere for a file to go without one - the Pop
 * runs on the worker, and a drop that quietly opened a session would make
 * Connect mean nothing. And no live stream, because one pipeline takes one
 * source.
 */
function canAcceptDrop() {
    return Boolean(endpoint) && !streaming
}

/*
 * Which webcam control is showing, and whether the preview takes a drop.
 *
 * One control rather than three: while nothing is streaming it is a selector
 * named for what picking an entry does, and while something is it is a button
 * named for what pressing it does. The two are never both meaningful, so only
 * one is ever on the page.
 *
 * A live stream is also the one thing a dropped file cannot share - one
 * pipeline, one source - so the drop target is exactly the complement of it.
 */
function updateSourceControls() {
    webcamSelect.hidden = streaming
    // like the drop target: a camera has nowhere to stream to without a session
    webcamSelect.disabled = streaming || !endpoint || webcamSelect.children.length < 2
    disconnectButton.hidden = !streaming

    const dragging = previewWrapper.classList.contains('dragging')
    dropHint.classList.toggle('show', !streaming && (dragging || !hasPreviewMedia()))
    dropHint.classList.toggle('idle', !canAcceptDrop())
    if (canAcceptDrop()) {
        dropHintTitle.textContent = 'Drop an image or a video here'
        dropHintNote.textContent = 'or click to choose one - the same Pop, the same overlay, the same 3D tab'
    } else {
        dropHintTitle.textContent = 'Connect first, then drop an image or a video here'
        dropHintNote.textContent = 'The Pop runs on a worker, so there is nothing to drop a file into until a session is open.'
    }

    if (streaming) {
        previewNote.textContent = 'Live webcam. Disconnect it to run a file through the same Pop instead.'
    } else if (loadedFile) {
        previewNote.textContent =
            `${loadedFile.name}. Changing the feature or the calibration runs it again; drop another file to replace it.`
    } else {
        previewNote.textContent = ''
    }
}

/*
 * The run a result belongs to.
 *
 * A result stream is cancelled but not awaited, so the loop reading it can get
 * one more turn after its source has been replaced. Drawing that would put the
 * old source's overlay on the new source's frame, so every loop carries the
 * token it started with and stops as soon as it is no longer the current one.
 */
let sourceToken = 0

/* ---------- files dropped on the preview ---------- */

/* ---------- fullscreen ---------- */

/*
 * The two views go fullscreen on their own, and say which they are.
 *
 * Prefixed fallbacks because a demo gets opened in whatever browser is to hand
 * and Safari still answers only to the webkit spelling. The button's label says
 * what pressing it does, like the other two toggles on this page.
 */
function fullscreenElement() {
    return document.fullscreenElement ?? document.webkitFullscreenElement ?? undefined
}

function requestFullscreen(element) {
    const request = element.requestFullscreen ?? element.webkitRequestFullscreen
    if (!request) {
        return Promise.reject(new Error('this browser has no fullscreen API'))
    }
    return Promise.resolve(request.call(element))
}

function leaveFullscreen() {
    const exit = document.exitFullscreen ?? document.webkitExitFullscreen
    return exit ? Promise.resolve(exit.call(document)) : Promise.resolve()
}

async function toggleFullscreen(element) {
    try {
        if (fullscreenElement() === element) {
            await leaveFullscreen()
            return
        }
        await requestFullscreen(element)
        // the 3D view takes the arrow keys only while it has focus, and entering
        // fullscreen is the one moment it is certain to be the thing being used
        element.focus?.()
    } catch (e) {
        setStatus(`Fullscreen refused: ${e.message}`, true)
    }
}

function updateFullscreenButtons() {
    const active = fullscreenElement()
    for (const [button, element] of [
        [previewFullscreen, previewWrapper],
        [worldFullscreen, worldContainer],
    ]) {
        const on = active === element
        button.textContent = on ? '\u26F6 Exit fullscreen' : '\u26F6 Fullscreen'
        button.title = on ? 'Exit fullscreen' : 'Fullscreen'
        button.setAttribute('aria-label', button.title)
    }
}

function setupFullscreen() {
    previewFullscreen.addEventListener('click', () => toggleFullscreen(previewWrapper))
    worldFullscreen.addEventListener('click', () => toggleFullscreen(worldContainer))
    // Escape and the browser's own chrome leave fullscreen without going through
    // either button, so the labels follow the event rather than the click
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
        document.addEventListener(type, updateFullscreenButtons)
    }
    updateFullscreenButtons()
}

/*
 * The shape of what the preview is holding.
 *
 * Only fullscreen needs it - everywhere else the frame is simply as wide as the
 * page and as tall as the media makes it - but the overlay is stretched over
 * the frame, so a frame that is not the media's shape puts the overlay beside
 * the picture instead of on it.
 */
function setPreviewAspect(width, height) {
    if (width > 0 && height > 0) {
        previewFrame.style.setProperty('--media-ratio', String(width / height))
    }
}

function setupDropTarget() {
    dropHint.addEventListener('click', () => {
        if (!canAcceptDrop()) {
            setStatus(streaming ? 'Disconnect the webcam first - one pipeline takes one source.' : 'Press Connect first.', true)
            return
        }
        fileInput.click()
    })
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        // cleared so choosing the same file a second time still fires change
        fileInput.value = ''
        if (file) {
            loadFile(file)
        }
    })

    // dragover has to be cancelled on every event rather than only the first,
    // or the browser keeps its own "not here" cursor and never fires drop
    for (const type of ['dragenter', 'dragover']) {
        previewWrapper.addEventListener(type, event => {
            // left uncancelled when there is nowhere to put a file, which is
            // what makes the browser show its own "not here" cursor
            if (!canAcceptDrop()) {
                return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            previewWrapper.classList.add('dragging')
            updateSourceControls()
        })
    }
    for (const type of ['dragleave', 'dragend']) {
        previewWrapper.addEventListener(type, event => {
            // dragleave fires again for every child the pointer crosses; only
            // the one that leaves the wrapper itself ends the drag
            if (type === 'dragleave' && previewWrapper.contains(event.relatedTarget)) {
                return
            }
            previewWrapper.classList.remove('dragging')
            updateSourceControls()
        })
    }
    previewWrapper.addEventListener('drop', event => {
        event.preventDefault()
        previewWrapper.classList.remove('dragging')
        const file = event.dataTransfer?.files?.[0]
        if (streaming) {
            setStatus('Disconnect the webcam first - one pipeline takes one source.', true)
        } else if (!endpoint) {
            setStatus('Press Connect first - a file needs a worker session to run on.', true)
        } else if (file) {
            loadFile(file)
        }
        updateSourceControls()
    })

    /*
     * A file that misses the target - or lands on a preview already streaming -
     * would otherwise be opened by the browser, replacing the page with the very
     * video the user meant to measure.
     *
     * Cancelled on the document for both events rather than only outside the
     * wrapper: cancelling dragover is also what makes a drop fire at all, so
     * this is what lets the handler above report that a stream is in the way
     * instead of the page simply navigating out from under it.
     */
    for (const type of ['dragover', 'drop']) {
        document.addEventListener(type, event => event.preventDefault())
    }
}

/*
 * Put a file in the preview and read the one thing a browser will say about it.
 *
 * The resolution, like a camera's, because fy/fx is the frame's aspect ratio -
 * a dropped portrait still is not calibrated by numbers derived for a webcam.
 */
function showFileInPreview(file, isVideo) {
    clearPreview()
    previewUrl = URL.createObjectURL(file)
    return new Promise((resolve, reject) => {
        const element = isVideo ? localVideo : localImage
        const failed = () => reject(new Error('the browser could not decode it'))
        const loaded = () =>
            resolve({
                width: isVideo ? localVideo.videoWidth : localImage.naturalWidth,
                height: isVideo ? localVideo.videoHeight : localImage.naturalHeight,
            })
        localVideo.hidden = !isVideo
        localImage.hidden = isVideo
        element.addEventListener(isVideo ? 'loadedmetadata' : 'load', loaded, { once: true })
        element.addEventListener('error', failed, { once: true })
        element.src = previewUrl
        if (isVideo) {
            localVideo.load()
        }
    })
}

async function loadFile(file) {
    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) {
        setStatus(`${file.name} is ${file.type || 'of an unknown type'}, not an image or a video.`, true)
        return
    }
    if (!canAcceptDrop()) {
        setStatus('Press Connect first - a file needs a worker session to run on.', true)
        return
    }

    // dropped before the load rather than in the failure path: the preview is
    // cleared either way, and two files dropped in quick succession would
    // otherwise let the first one's failure land after the second one's success
    loadedFile = undefined
    let size
    try {
        size = await showFileInPreview(file, isVideo)
    } catch (e) {
        updateSourceControls()
        setStatus(`Could not read ${file.name}: ${e.message}`, true)
        return
    }
    loadedFile = file
    updateSourceControls()

    if (size.width && size.height) {
        setPreviewAspect(size.width, size.height)
        probedSettings = { width: size.width, height: size.height }
        describeSource(
            `${file.name}: ${size.width} x ${size.height}. A file carries no focal length either, so the ` +
                'values below are derived from the assumed field of view.',
        )
    }
    await processLoadedFile()
}

// A Pop or a calibration only reaches the worker with a source, so a change to
// either is only visible on the next run: a live stream gets one on its next
// frame, a file has to be sent again.
function reprocessLoadedFile() {
    return processLoadedFile()
}

async function processLoadedFile() {
    if (!loadedFile || !endpoint || streaming) {
        return
    }
    let camera
    try {
        camera = cameraFromInputs()
    } catch (e) {
        setStatus(`Calibration rejected: ${e.message}`, true)
        return
    }
    if (!camera) {
        setStatus('No calibration, so the worker assumes a 60 degree field of view.')
    }

    const token = ++sourceToken
    cancelResultStream()
    stopPlayback()
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)
    describeWorldFrame(camera)
    setStatus(`Processing ${loadedFile.name}...`)

    const file = loadedFile
    let results
    try {
        results = await endpoint.process({ source: { file: file }, camera: camera })
    } catch (e) {
        setStatus(`Could not process ${file.name}: ${e.message}`, true)
        return
    }
    if (token !== sourceToken) {
        results.cancel()
        return
    }
    resultStream = results
    consumeResults(results, token, file, file.type.startsWith('video/'))
}

/*
 * Draw a source's results, and for a video move the preview with them.
 *
 * The preview is seeked to each prediction's own timestamp and only then drawn,
 * rather than played at real time with the overlay laid over whatever frame
 * happens to be showing. A worker is rarely exactly as fast as the media it is
 * reading, and an overlay half a second out is a measurement of the wrong
 * frame. It also keeps one prediction in hand rather than all of them: a scene
 * cloud is megabytes, and a minute of those is not something to buffer.
 *
 * A still is the same loop with nothing to seek - one frame, already showing.
 */
async function consumeResults(results, token, file, isVideo) {
    let frames = 0
    try {
        for await (const result of results) {
            if (token !== sourceToken) {
                return
            }
            frames += 1
            if (isVideo) {
                await seekPreview(result.seconds ?? 0)
                if (token !== sourceToken) {
                    return
                }
                setStatus(`${file.name}: frame ${frames} at ${(result.seconds ?? 0).toFixed(2)} s.`)
            }
            drawPrediction(result)
        }
    } catch (e) {
        setStatus(`Result stream ended: ${e.message}`, true)
        return
    }
    if (token !== sourceToken) {
        return
    }
    if (!frames) {
        setStatus(`The worker returned no prediction for ${file.name}.`, true)
    } else {
        setStatus(isVideo ? `${file.name} done: ${frames} frames.` : `${file.name} done.`)
    }
}

// A seek that never lands would stall the result stream waiting behind it, so
// the wait is bounded and a frame the browser could not produce is simply drawn
// over whichever one it is still showing.
const SEEK_TIMEOUT_MS = 2000

function seekPreview(seconds) {
    return new Promise(resolve => {
        const duration = localVideo.duration
        if (!Number.isFinite(duration) || duration <= 0) {
            resolve()
            return
        }
        const target = Math.min(Math.max(seconds, 0), duration - 0.001)
        if (Math.abs(localVideo.currentTime - target) < 0.001) {
            resolve()
            return
        }
        let timer = undefined
        const done = () => {
            clearTimeout(timer)
            localVideo.removeEventListener('seeked', done)
            resolve()
        }
        localVideo.addEventListener('seeked', done)
        timer = setTimeout(done, SEEK_TIMEOUT_MS)
        localVideo.currentTime = target
    })
}

// The preview is stepped by the results rather than playing on its own, so
// there is nothing to stop but a play() the browser started by itself.
function stopPlayback() {
    localVideo.pause()
}

/* ---------- the webcam ---------- */

async function connectWebcam() {
    const deviceId = webcamSelect.value
    if (!deviceId) {
        return
    }
    if (!endpoint) {
        webcamSelect.value = ''
        setStatus('Press Connect first.', true)
        return
    }
    webcamSelect.disabled = true
    // the resolution first: it is what fx and fy are derived from, and a stream
    // cannot be recalibrated once it is already negotiating
    await probeDevice(deviceId)
    await startStream(deviceId)
    updateSourceControls()
}

async function startStream(deviceId) {
    let camera
    try {
        camera = cameraFromInputs()
    } catch (e) {
        setStatus(`Calibration rejected: ${e.message}`, true)
        return
    }
    if (!camera) {
        setStatus('No calibration, so the worker assumes a 60 degree field of view.')
    }

    sourceToken += 1
    cancelResultStream()
    stopPlayback()
    loadedFile = undefined
    clearPreview()

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
        localVideo.hidden = false
        localVideo.srcObject = stream
        await localVideo.play()
        setPreviewAspect(localVideo.videoWidth, localVideo.videoHeight)

        resultStream = await endpoint.process({ source: { mediaStream: stream }, camera: camera })
        streaming = true
        describeWorldFrame(camera)
        setStatus(
            selectedFeature() === 'hands'
                ? 'Measuring. Hold both wrists in view.'
                : 'Streaming. The 3D tab is where the cloud appears.',
        )
        renderFromResultStream(resultStream)
            .catch(e => setStatus(`Result stream ended: ${e.message}`, true))
            .finally(() => console.log('result stream finished'))
    } catch (e) {
        clearPreview()
        // back to the placeholder, so the camera that just failed can be picked
        // again and still fire a change
        webcamSelect.value = ''
        setStatus(`Could not connect the webcam: ${e.message}`, true)
    }
}

async function disconnectWebcam() {
    disconnectButton.disabled = true
    sourceToken += 1
    cancelResultStream()
    streaming = false
    clearPreview()
    // back to the placeholder, so picking the same camera again is still a
    // change event and still connects it
    webcamSelect.value = ''
    disconnectButton.disabled = false
    resetResults()
    updateSourceControls()
    setStatus('Webcam disconnected. Pick a camera again, or drop an image or a video on the preview.')
}

document.addEventListener('DOMContentLoaded', setup)
