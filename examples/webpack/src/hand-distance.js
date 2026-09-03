/*
 * Measures the distance between a person's hands, live, from a webcam.
 *
 * A 2d-body-points component asks for world coordinates, back-projected
 * through a frame level depth map, and the two wrists come back in metres.
 * The wrists are the hands here: the 2D body model has no hand point of its
 * own, and a wrist is the closest joint it does place.
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

let endpoint = undefined
let resultStream = undefined
let probedSettings = undefined

let connectButton, startButton, stopButton, deviceSelect, statusLine
let detectedLine, hfovInput, deriveButton, fxInput, fyInput, cxInput, cyInput
let extrinsicsSwitch, yawInput, tiltInput, heightInput, quaternionField, worldFrameNote
let popJsonElement, measurementsList
let localVideo, overlay, overlayContext

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
// Point diameter in metres, since sizeAttenuation is on: a point is a fixed
// size in the scene rather than on screen, so it shrinks with distance like
// everything else.
const POINT_SIZE_METRES = 0.06

const MAX_POINTS = 200000
const MAX_SEGMENTS = 60000

function handDistancePop() {
    return {
        components: [
            {
                type: PopComponentType.INFERENCE,
                model: 'eyepop.person:latest',
                categoryName: 'person',
                forward: {
                    operator: {
                        type: ForwardOperatorType.CROP,
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
    popJsonElement = document.getElementById('pop-json')
    measurementsList = document.getElementById('measurements')
    extrinsicsSwitch = document.getElementById('extrinsics-on')
    yawInput = document.getElementById('yaw')
    tiltInput = document.getElementById('tilt')
    heightInput = document.getElementById('height')
    quaternionField = document.getElementById('quaternion')
    worldFrameNote = document.getElementById('world-frame-note')
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
    extrinsicsSwitch.addEventListener('change', updateExtrinsicsEnabled)
    for (const field of [yawInput, tiltInput, heightInput]) {
        field.addEventListener('change', showQuaternion)
    }
    for (const button of document.querySelectorAll('#view-tabs .nav-link')) {
        button.addEventListener('click', () => showView(button.dataset.view))
    }
    for (const header of document.querySelectorAll('.section-header')) {
        header.addEventListener('click', () => toggleSection(header))
    }

    setupWorldView(document.getElementById('world-canvas'))
    showView('video')
    updateExtrinsicsEnabled()
    describeWorldFrame(undefined)

    connectButton.disabled = false
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
        detectedLine.textContent =
            'That camera did not report a resolution, so fx and fy cannot be derived. Type them in.'
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
    const extrinsics = extrinsicsFromInputs()
    const camera = extrinsics ? { intrinsics: intrinsics, extrinsics: extrinsics } : { intrinsics: intrinsics }
    validateCamera(camera)
    return camera
}

async function connect() {
    connectButton.disabled = true
    setStatus('Connecting...')
    try {
        if (!endpoint) {
            // minted by webpack.config.js at build time from EYEPOP_API_KEY and
            // emitted as an asset: the key stays on the build host, and only the
            // short lived session reaches the browser
            const session = await (await fetch('eyepop-session.json')).json()
            endpoint = await EyePop.workerEndpoint({ auth: { session: session } }).onStateChanged((from, to) => {
                console.log(`Endpoint state transition from ${from} to ${to}`)
            })
            await endpoint.connect()
            await endpoint.changePop(handDistancePop())
        }
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

    const add = (label, points, segments) => {
        if (points.length) {
            series.push({ label: label, points: points, segments: segments })
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
                add(`${name} mask`, cloudPoints(cloud), [])
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
        add('scene', cloudPoints(scene), [])
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
    points: undefined,
    lines: undefined,
    pointPositions: undefined,
    pointColours: undefined,
    linePositions: undefined,
    lineColours: undefined,
    visible: false,
}

function setupWorldView(container) {
    world.renderer = new THREE.WebGLRenderer({ antialias: true })
    world.renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(world.renderer.domElement)

    world.scene = new THREE.Scene()
    world.scene.background = new THREE.Color(0x101418)

    world.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500)
    // three.js is Y-up by default and the EyePop world frame is Z-up, so the
    // camera's up axis is set before the controls read it - otherwise orbiting
    // rolls the scene onto its side
    world.camera.up.set(0, 0, 1)
    world.camera.position.copy(DEFAULT_TARGET).addScaledVector(DEFAULT_OFFSET, 1 / DEFAULT_ZOOM)

    world.controls = new OrbitControls(world.camera, world.renderer.domElement)
    world.controls.target.copy(DEFAULT_TARGET)
    world.controls.enableDamping = true

    world.scene.add(new THREE.AxesHelper(1))
    const grid = new THREE.GridHelper(10, 20, 0x445566, 0x223344)
    // the helper lies in XZ; a quarter turn about X puts it on the ground plane
    grid.rotation.x = Math.PI / 2
    world.scene.add(grid)

    world.pointPositions = new Float32Array(MAX_POINTS * 3)
    world.pointColours = new Float32Array(MAX_POINTS * 3)
    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(world.pointPositions, 3))
    pointGeometry.setAttribute('color', new THREE.BufferAttribute(world.pointColours, 3))
    pointGeometry.setDrawRange(0, 0)
    world.points = new THREE.Points(
        pointGeometry,
        new THREE.PointsMaterial({ size: POINT_SIZE_METRES, vertexColors: true, sizeAttenuation: true }),
    )
    world.scene.add(world.points)

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
    if (!world.points) {
        return
    }
    const colour = new THREE.Color()
    let pointCount = 0
    let vertexCount = 0

    series.forEach((entry, index) => {
        colour.setHex(SERIES_COLOURS[index % SERIES_COLOURS.length])
        const base = pointCount
        for (const point of entry.points) {
            if (pointCount >= MAX_POINTS) {
                break
            }
            const at = pointCount * 3
            world.pointPositions[at] = point.x
            world.pointPositions[at + 1] = point.y
            world.pointPositions[at + 2] = point.z
            world.pointColours[at] = colour.r
            world.pointColours[at + 1] = colour.g
            world.pointColours[at + 2] = colour.b
            pointCount += 1
        }
        for (const segment of entry.segments) {
            if (vertexCount + 2 > MAX_SEGMENTS * 2) {
                break
            }
            for (const end of segment) {
                const from = (base + end) * 3
                const at = vertexCount * 3
                world.linePositions[at] = world.pointPositions[from]
                world.linePositions[at + 1] = world.pointPositions[from + 1]
                world.linePositions[at + 2] = world.pointPositions[from + 2]
                world.lineColours[at] = colour.r
                world.lineColours[at + 1] = colour.g
                world.lineColours[at + 2] = colour.b
                vertexCount += 1
            }
        }
    })

    world.points.geometry.setDrawRange(0, pointCount)
    world.points.geometry.attributes.position.needsUpdate = true
    world.points.geometry.attributes.color.needsUpdate = true
    world.lines.geometry.setDrawRange(0, vertexCount)
    world.lines.geometry.attributes.position.needsUpdate = true
    world.lines.geometry.attributes.color.needsUpdate = true
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
        updateWorldView(labelledWorldPoints(result))
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
        worldFrameNote.textContent = 'Nothing streaming yet.'
        return
    }
    worldFrameNote.textContent = camera.extrinsics
        ? 'World frame: Z up, ground at Z = 0, the camera placed by the pose above.'
        : 'Camera frame: X right, Y down, Z forward, origin at the lens. Turn on extrinsics for a world frame.'
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
        describeWorldFrame(camera)
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
