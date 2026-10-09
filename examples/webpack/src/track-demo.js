/*
 * Tracks, and one late result per track, from a webcam or a dropped video.
 *
 * The Pop is always the same chain: a person detector, a tracker with
 * re-identification behind it, and a select forward from the tracker to an
 * ability the page asks for. The ability does not run on every frame. Per track,
 * the worker keeps the most relevant detection it has seen and runs the ability
 * once on the past frame that detection was in. Its results come back as
 * selected predictions: `selected` is set, the timestamp is that past frame's,
 * and the selected object's trackId says which track they belong to.
 *
 * So the page reads two kinds of prediction off one stream. Live ones move the
 * video and the overlay, and say which tracks exist and for how long. Selected
 * ones never touch the video - they are about a frame already gone - and only
 * fill in the track list.
 */
import { EyePop, ForwardOperatorType, PopComponentType, SelectMode, validatePop } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

const PERSON_ABILITY = 'eyepop.person:latest'
const REID_ABILITY = 'eyepop.person.reid:latest'

const NANOS_PER_SECOND = 1e9

// A track that has not been seen for this long, and has not ended either, is
// shown as out of view: the tracker keeps it a while in case it comes back.
const UNSEEN_AFTER_NANOS = 1 * NANOS_PER_SECOND

let endpoint = undefined
let resultStream = undefined

// The webcam, not the endpoint: true only while a MediaStream is being
// processed, which is what the drop target and the two webcam controls key off.
let streaming = false

// The video currently loaded into the preview, kept so a change of the Pop can
// run it again rather than asking for it to be dropped twice.
let loadedFile = undefined
let previewUrl = undefined

let connectButton, connectSpinner, connectLabel, webcamSelect, disconnectButton, statusLine
let abilityInput, relevancyInput, minTrackLengthInput, intervalInput
let popJsonElement, popEditButton, popSaveButton, popError, tracksBody, trackCount
// a Pop saved from the editor, which takes the place of the one the inputs
// describe until an input changes again
let savedPop = undefined
let editingPop = false
let localVideo, overlay, overlayContext
let previewWrapper, previewFrame, dropHint, dropHintTitle, dropHintNote, fileInput, previewNote
let previewFullscreen
let overlayRenderer

function setStatus(message, isError) {
    statusLine.textContent = message
    statusLine.className = isError ? 'm-2 text-danger' : 'm-2 text-muted'
}

/* ---------- the Pop ---------- */

function selectedOperator() {
    return document.querySelector('input[name="operator"]:checked')?.value ?? ForwardOperatorType.SELECT_CROP
}

function optionalNumber(input) {
    const value = parseFloat(input.value)
    return Number.isFinite(value) ? value : undefined
}

function optionalText(input) {
    const value = input.value.trim()
    return value ? value : undefined
}

/*
 * person -> tracking (re-identified) -> select -> the ability asked for.
 *
 * The tracker sits behind a crop forward because it tracks the detector's
 * objects; the select goes on the tracker's own forward, which is the only place
 * a select is valid. Fields left empty are left out rather than sent as zero:
 * an interval of nothing means "only when the track ends", not "every 0 s".
 */
function currentPop() {
    const ability = optionalText(abilityInput)
    if (!ability) {
        throw new Error('name an ability to run on the selected detections')
    }
    const operator = {
        type: selectedOperator(),
        select: {
            mode: SelectMode.MOST_RELEVANT,
            relevancyModel: optionalText(relevancyInput),
            minTrackLengthSeconds: optionalNumber(minTrackLengthInput),
            intervalSeconds: optionalNumber(intervalInput),
        },
    }
    const pop = {
        components: [
            {
                type: PopComponentType.INFERENCE,
                ability: PERSON_ABILITY,
                categoryName: 'person',
                threshold: 0.8,
                forward: {
                    operator: { type: ForwardOperatorType.CROP },
                    targets: [
                        {
                            type: PopComponentType.TRACKING,
                            reidModel: REID_ABILITY,
                            maxAgeSeconds: 2.0,
                            forward: {
                                operator: operator,
                                targets: [{ type: PopComponentType.INFERENCE, ability: ability }],
                            },
                        },
                    ],
                },
            },
        ],
    }
    // JSON.stringify drops the undefined members, which is what keeps the Pop
    // shown below the one actually sent
    const sent = JSON.parse(JSON.stringify(pop))
    // here rather than as a 400 from the worker once the Pop is in flight
    validatePop(sent)
    return sent
}

/*
 * Show the Pop the inputs describe, and hand it to the worker if one is already
 * connected.
 *
 * changePop is how a Pop is meant to be swapped on a running pipeline. The
 * endpoint asks for the prediction version that carries selected predictions
 * whenever its Pop has a select forward, so nothing else has to opt in.
 */
async function applyPop() {
    // the inputs describe a new Pop, which replaces one saved from the editor
    savedPop = undefined
    // there is no default ability: until one is named there is no Pop, which
    // is a prompt rather than an error
    if (!optionalText(abilityInput)) {
        showPop(undefined)
        setStatus('Name an ability to run on the selected detections.')
        return
    }
    let pop
    try {
        pop = currentPop()
    } catch (e) {
        setStatus(`Pop rejected: ${e.message}`, true)
        return
    }
    showPop(pop)
    if (!endpoint) {
        return
    }
    try {
        await endpoint.changePop(pop)
        setStatus('Pop changed.')
    } catch (e) {
        setStatus(`Could not change the pop: ${e.message}`, true)
        return
    }
    // a live stream picks the new Pop up on its next frame; a file is run again,
    // and its tracks start over with it
    await processLoadedFile()
}

/* ---------- editing the Pop ---------- */

// The Pop below the inputs, unless it is being edited: an input changed while
// editing must not throw the edit away.
function showPop(pop) {
    if (!editingPop) {
        popJsonElement.value = pop ? JSON.stringify(pop, undefined, 2) : ''
    }
}

function showPopError(message) {
    popError.textContent = message ?? ''
    popError.hidden = !message
}

function setEditingPop(editing) {
    editingPop = editing
    popJsonElement.readOnly = !editing
    popEditButton.hidden = editing
    popSaveButton.hidden = !editing
    if (editing) {
        popJsonElement.focus()
    } else {
        showPopError(undefined)
    }
}

/*
 * Save what the editor holds as the Pop: parse it, validate it and, when
 * connected, hand it to the worker. Any of the three failing keeps the editor
 * open, with the error above it, so the Pop can be fixed and saved again.
 */
async function savePop() {
    popSaveButton.disabled = true
    try {
        let pop
        try {
            pop = JSON.parse(popJsonElement.value)
        } catch (e) {
            showPopError(`Not valid JSON: ${e.message}`)
            return
        }
        try {
            validatePop(pop)
        } catch (e) {
            showPopError(`Pop rejected: ${e.message}`)
            return
        }
        if (endpoint) {
            try {
                await endpoint.changePop(pop)
            } catch (e) {
                showPopError(`Could not change the pop: ${e.message}`)
                return
            }
        }
        savedPop = pop
        setEditingPop(false)
        popJsonElement.value = JSON.stringify(pop, undefined, 2)
        if (endpoint) {
            setStatus('Pop changed.')
            // as for a Pop from the inputs: a file is run again with it
            await processLoadedFile()
        } else {
            setStatus('Pop saved; it is used when you connect.')
        }
    } finally {
        popSaveButton.disabled = false
    }
}

/* ---------- the track list ---------- */

/*
 * One entry per track id, filled from two directions.
 *
 * Live predictions say a track exists, when it was first and last seen, and -
 * through track_events - when the tracker started and ended it. Selected
 * predictions add what the ability found on the track's best frame. Times are
 * stream time in nanoseconds, the unit of every timestamp on a prediction.
 */
const tracks = new Map()

// The newest live timestamp, the "now" an age and an out-of-view are measured
// against. Wall time would be wrong for a video stepped by its results.
let streamNow = undefined

function trackFor(trackId) {
    let track = tracks.get(trackId)
    if (!track) {
        track = {
            id: trackId,
            classLabel: undefined,
            firstSeen: undefined,
            lastSeen: undefined,
            ended: false,
            endedAt: undefined,
            selections: 0,
            // the timestamps of the frames selected, oldest first
            selectedAts: [],
            result: undefined,
            line: undefined,
            // bumped whenever the result cell has something new to show, so
            // the cell is rebuilt only then and an opened line stays open
            version: 0,
            row: undefined,
            flash: false,
        }
        tracks.set(trackId, track)
    }
    return track
}

function seen(track, timestamp) {
    if (timestamp === undefined) {
        return
    }
    if (track.firstSeen === undefined || timestamp < track.firstSeen) {
        track.firstSeen = timestamp
    }
    if (track.lastSeen === undefined || timestamp > track.lastSeen) {
        track.lastSeen = timestamp
    }
}

// Every tracked object, at any depth: the tracker tags the detector's objects,
// which are top level here, but a Pop nesting them deeper should still work.
function trackedObjects(objects, found = []) {
    for (const object of objects || []) {
        if (typeof object?.trackId === 'number') {
            found.push(object)
        }
        trackedObjects(object?.objects, found)
    }
    return found
}

function noteLivePrediction(prediction) {
    const timestamp = prediction.timestamp
    if (timestamp !== undefined && (streamNow === undefined || timestamp > streamNow)) {
        streamNow = timestamp
    }
    for (const object of trackedObjects(prediction.objects)) {
        const track = trackFor(object.trackId)
        track.classLabel = object.classLabel ?? track.classLabel
        seen(track, timestamp)
    }
    // the tracker's own account, on the live line only: when it started a
    // track, which can be before the first frame this page saw it on, and when
    // it gave one up
    for (const event of prediction.track_events || []) {
        const track = trackFor(event.track_id)
        if (typeof event.started_at === 'number') {
            track.firstSeen = track.firstSeen === undefined ? event.started_at : Math.min(track.firstSeen, event.started_at)
        }
        if (event.is_ended) {
            track.ended = true
            track.endedAt = typeof event.ended_at === 'number' ? event.ended_at : timestamp
        }
    }
    scheduleTableUpdate()
}

/*
 * What an ability's results say, short enough for a table cell.
 *
 * Generic on purpose, since the ability is whatever was typed in: classes with
 * their confidence, texts, key point and embedding groups by size, details as
 * their members, and nested objects with what is nested in them. Details carry
 * the results here as often as the rest: an ability that describes what it
 * sees (age, clothing, a caption) reports them on the object it looked at.
 */
function describe(node) {
    const parts = []
    for (const clazz of node?.classes || []) {
        parts.push(`${clazz.classLabel ?? clazz.category ?? 'class'}${percent(clazz.confidence)}`)
    }
    for (const text of node?.texts || []) {
        parts.push(`"${text.text}"`)
    }
    for (const group of node?.keyPoints || []) {
        parts.push(`${group.category ?? 'key points'} (${group.points?.length ?? 0} points)`)
    }
    for (const embedding of node?.embeddings || []) {
        parts.push(`${embedding.category ?? 'embedding'} (${embedding.embedding?.length ?? 0} values)`)
    }
    for (const mesh of node?.meshs || []) {
        parts.push(mesh.category ?? 'mesh')
    }
    // free-form records, which is how an ability describing what it sees -
    // age, clothing, a caption - reports: every member, as it came
    for (const detail of node?.details || []) {
        const fields = Object.entries(detail ?? {}).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
        if (fields.length) {
            parts.push(fields.join(', '))
        }
    }
    for (const object of node?.objects || []) {
        const inner = describe(object)
        const label = `${object.classLabel ?? 'object'}${percent(object.confidence)}`
        parts.push(inner.length ? `${label} [${inner.join(', ')}]` : label)
    }
    return parts
}

// a mask, a depth map or an embedding can be megabytes of base64 or numbers,
// none of it worth reading in a table cell
function withoutBinary(key, value) {
    if (typeof value === 'string' && value.length > 200) {
        return `<${value.length} characters>`
    }
    if (Array.isArray(value) && value.length > 32 && typeof value[0] === 'number') {
        return `<${value.length} numbers>`
    }
    return value
}

function percent(confidence) {
    return typeof confidence === 'number' ? ` ${Math.round(confidence * 100)}%` : ''
}

/*
 * A selected prediction: the ability's results for one track.
 *
 * Its one tracked object is the selected detection, with what the ability found
 * on a crop of it nested inside. A whole-frame selection can also carry results
 * that belong to the frame rather than the object - anything else on the
 * prediction - and those are described after it.
 */
function noteSelectedPrediction(prediction) {
    const [selected] = trackedObjects(prediction.objects)
    if (!selected) {
        return
    }
    const track = trackFor(selected.trackId)
    track.classLabel = track.classLabel ?? selected.classLabel
    track.selections += 1
    if (prediction.timestamp !== undefined) {
        track.selectedAts.push(prediction.timestamp)
    }
    const frame = {
        objects: (prediction.objects || []).filter(object => object !== selected),
        classes: prediction.classes,
        texts: prediction.texts,
        keyPoints: prediction.keyPoints,
        embeddings: prediction.embeddings,
        meshs: prediction.meshs,
    }
    const parts = describe(selected).concat(describe(frame))
    track.result = parts.length ? parts.join(' · ') : 'nothing found'
    track.line = JSON.stringify(prediction, withoutBinary, 2)
    track.version += 1
    track.flash = true
    scheduleTableUpdate()
}

function formatTime(nanos) {
    if (nanos === undefined) {
        return '-'
    }
    const seconds = nanos / NANOS_PER_SECOND
    const minutes = Math.floor(seconds / 60)
    const rest = seconds - minutes * 60
    return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}

function formatDuration(nanos) {
    if (nanos === undefined || nanos < 0) {
        return '-'
    }
    return `${(nanos / NANOS_PER_SECOND).toFixed(1)} s`
}

// How long a track has lasted: to its end, or to when it was last seen.
function ageOf(track) {
    const until = track.ended ? track.endedAt ?? track.lastSeen : track.lastSeen
    return track.firstSeen === undefined || until === undefined ? undefined : until - track.firstSeen
}

// An ended track shorter than the min track length, which is never selected.
function endedTooShort(track) {
    const minSeconds = optionalNumber(minTrackLengthInput)
    const age = ageOf(track)
    return track.ended && minSeconds !== undefined && age !== undefined && age < minSeconds * NANOS_PER_SECOND
}

function stateOf(track) {
    // rank orders the table: active tracks on top, then those out of view,
    // which may still come back, then those the tracker ended, and last the
    // ended ones too short to be selected
    if (endedTooShort(track)) {
        return { label: 'too short', className: 'text-bg-light border', rank: 3 }
    }
    if (track.ended) {
        return { label: 'ended', className: 'text-bg-secondary', rank: 2 }
    }
    if (streamNow !== undefined && track.lastSeen !== undefined && streamNow - track.lastSeen > UNSEEN_AFTER_NANOS) {
        return { label: 'out of view', className: 'text-bg-warning', rank: 1 }
    }
    return { label: 'active', className: 'text-bg-success', rank: 0 }
}

/*
 * The table follows the map at most once per animation frame.
 *
 * Predictions arrive at the stream's rate, and a table rewritten thirty times a
 * second is the browser's whole budget. Rows are kept and updated in place, so a
 * row's flash survives the updates that follow it.
 */
let tableUpdatePending = false

function scheduleTableUpdate() {
    if (tableUpdatePending) {
        return
    }
    tableUpdatePending = true
    requestAnimationFrame(() => {
        tableUpdatePending = false
        updateTable()
    })
}

function makeRow() {
    const row = document.createElement('tr')
    for (let i = 0; i < 7; i++) {
        row.appendChild(document.createElement('td'))
    }
    row.cells[0].className = 'fw-semibold'
    row.cells[6].className = 'track-result'
    return row
}

function updateTable() {
    trackCount.textContent = String(tracks.size)
    if (!tracks.size) {
        tracksBody.replaceChildren()
        const row = document.createElement('tr')
        const cell = document.createElement('td')
        cell.colSpan = 7
        cell.className = 'text-muted'
        cell.textContent = 'Nothing tracked yet.'
        row.appendChild(cell)
        tracksBody.appendChild(row)
        return
    }
    if (tracksBody.querySelector('td[colspan]')) {
        tracksBody.replaceChildren()
    }
    for (const track of tracks.values()) {
        if (!track.row) {
            track.row = makeRow()
            tracksBody.appendChild(track.row)
        }
        const cells = track.row.cells
        cells[0].textContent = String(track.id)
        cells[1].textContent = track.classLabel ?? '-'
        cells[2].textContent = formatTime(track.firstSeen)
        const age = ageOf(track)
        cells[3].textContent = age === undefined ? '-' : formatDuration(age)

        const state = stateOf(track)
        let badge = cells[4].firstElementChild
        if (!badge) {
            badge = document.createElement('span')
            cells[4].appendChild(badge)
        }
        badge.className = `badge ${state.className}`
        badge.textContent = state.label

        fillSelections(cells[5], track)

        const result = cells[6]
        if (result.dataset.version !== String(track.version)) {
            result.dataset.version = String(track.version)
            fillResult(result, track)
        }

        if (track.flash) {
            track.flash = false
            // removed and re-added with a reflow between, or a second selection
            // arriving mid-flash would not restart it
            track.row.classList.remove('flash')
            void track.row.offsetWidth
            track.row.classList.add('flash')
        }
    }
    orderRows()
}

// Up to this many selections are listed; past it, the most recent few and a
// count of the rest.
const LISTED_SELECTIONS = 4
const RECENT_SELECTIONS = 3

/*
 * Each selection as the track's age at the frame it picked, the same scale as
 * the age column, the most recent first. Rebuilt only when that list changes,
 * which is a new selection or an earlier start the tracker reported.
 */
function fillSelections(cell, track) {
    const key = `${track.selectedAts.length}:${track.firstSeen}`
    if (cell.dataset.key === key) {
        return
    }
    cell.dataset.key = key
    cell.replaceChildren()
    if (!track.selectedAts.length) {
        cell.textContent = '-'
        return
    }
    const recent = [...track.selectedAts].reverse()
    const shown = recent.length > LISTED_SELECTIONS ? recent.slice(0, RECENT_SELECTIONS) : recent
    const list = document.createElement('ul')
    list.className = 'mb-0 ps-3'
    for (const timestamp of shown) {
        const item = document.createElement('li')
        item.textContent = track.firstSeen === undefined ? formatTime(timestamp) : formatDuration(timestamp - track.firstSeen)
        list.appendChild(item)
    }
    cell.appendChild(list)
    if (shown.length < recent.length) {
        const more = document.createElement('div')
        more.className = 'text-muted small'
        more.textContent = `(${recent.length - shown.length} more)`
        cell.appendChild(more)
    }
}

function fillResult(cell, track) {
    cell.replaceChildren()
    const text = document.createElement('div')
    text.textContent = track.result ?? 'waiting for a selection'
    text.classList.toggle('text-muted', !track.result)
    cell.appendChild(text)
    // the selected prediction as it arrived: what the summary was read from,
    // and what to look at when the summary says less than expected
    if (track.line) {
        const details = document.createElement('details')
        const label = document.createElement('summary')
        label.textContent = 'line'
        label.className = 'text-muted small'
        const pre = document.createElement('pre')
        pre.className = 'track-line'
        pre.textContent = track.line
        details.append(label, pre)
        cell.appendChild(details)
    }
}

/*
 * Active tracks on top, then those out of view, then the ended ones, and at
 * the bottom the ended ones too short to be selected; within each, the newest
 * first, since a new track is what a viewer looks for.
 *
 * A row is moved only when it is out of place: moving a row restarts its
 * flash, and most updates change no track's place.
 */
function orderRows() {
    const ordered = [...tracks.values()].sort((a, b) => {
        const byState = stateOf(a).rank - stateOf(b).rank
        if (byState !== 0) {
            return byState
        }
        return (b.firstSeen ?? 0) - (a.firstSeen ?? 0) || b.id - a.id
    })
    ordered.forEach((track, index) => {
        if (tracksBody.children[index] !== track.row) {
            tracksBody.insertBefore(track.row, tracksBody.children[index] ?? null)
        }
    })
}

function resetTracks() {
    tracks.clear()
    streamNow = undefined
    updateTable()
}

/* ---------- predictions ---------- */

function drawPrediction(result) {
    // the overlay is stretched over the media by CSS, so drawing in the frame's
    // own coordinates needs no scaling of its own
    overlay.width = result.source_width
    overlay.height = result.source_height
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)
    overlayRenderer.draw(result)
}

async function renderFromResultStream(results, token) {
    for await (const result of results) {
        if (token !== sourceToken) {
            return
        }
        // a selection is about a frame long gone: the list takes it, the
        // live video does not
        if (result.selected) {
            noteSelectedPrediction(result)
            continue
        }
        if (!localVideo.srcObject) {
            continue
        }
        noteLivePrediction(result)
        drawPrediction(result)
    }
}

/* ---------- connecting ---------- */

async function setup() {
    connectButton = document.getElementById('connect')
    connectSpinner = document.getElementById('connect-spinner')
    connectLabel = document.getElementById('connect-label')
    webcamSelect = document.getElementById('webcam-select')
    disconnectButton = document.getElementById('webcam-disconnect')
    statusLine = document.getElementById('status')
    abilityInput = document.getElementById('ability')
    relevancyInput = document.getElementById('relevancy')
    minTrackLengthInput = document.getElementById('min-track-length')
    intervalInput = document.getElementById('interval')
    popJsonElement = document.getElementById('pop-json')
    popEditButton = document.getElementById('pop-edit')
    popSaveButton = document.getElementById('pop-save')
    popError = document.getElementById('pop-error')
    tracksBody = document.getElementById('tracks')
    trackCount = document.getElementById('track-count')
    localVideo = document.getElementById('local-video')
    overlay = document.getElementById('local-result-overlay')
    overlayContext = overlay.getContext('2d')
    previewWrapper = document.getElementById('preview')
    previewFrame = document.getElementById('preview-frame')
    previewFullscreen = document.getElementById('preview-fullscreen')
    dropHint = document.getElementById('drop-hint')
    dropHintTitle = document.getElementById('drop-hint-title')
    dropHintNote = document.getElementById('drop-hint-note')
    fileInput = document.getElementById('file-input')
    previewNote = document.getElementById('preview-note')

    // the people and their trails; the ability's own results are in the list,
    // since they belong to a past frame and never to the one on screen
    overlayRenderer = Render2d.renderer(overlayContext, [
        Render2d.renderBox({ showTrackId: true, target: '$.objects.*' }),
        Render2d.renderTrail({ trailLengthSeconds: 2 }),
    ])

    connectButton.addEventListener('click', toggleConnection)
    webcamSelect.addEventListener('change', connectWebcam)
    disconnectButton.addEventListener('click', disconnectWebcam)
    popEditButton.addEventListener('click', () => setEditingPop(true))
    popSaveButton.addEventListener('click', savePop)
    for (const header of document.querySelectorAll('.section-header')) {
        header.addEventListener('click', () => toggleSection(header))
    }
    for (const field of [abilityInput, relevancyInput, minTrackLengthInput, intervalInput]) {
        field.addEventListener('change', applyPop)
    }
    for (const radio of document.querySelectorAll('input[name="operator"]')) {
        radio.addEventListener('change', applyPop)
    }
    // the out-of-view state moves with stream time even when no track changes
    setInterval(scheduleTableUpdate, 1000)

    setupDropTarget()
    setupFullscreen()
    await applyPop()
    updateSourceControls()
    updateTable()

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
        setStatus(`No camera access: ${e.message}. Drop a video on the preview instead.`, true)
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
        setStatus('No video input devices found. Drop a video on the preview instead.', true)
        return
    }
    updateSourceControls()
}

/*
 * The button's own state, in the button.
 *
 * It is the session's one control, so it says what it will do rather than what
 * has happened: Connect while there is none, Disconnect while there is.
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

async function connect() {
    if (endpoint) {
        return
    }
    let pop = savedPop
    if (!pop) {
        try {
            pop = currentPop()
        } catch (e) {
            setStatus(`Pop rejected: ${e.message}`, true)
            return
        }
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
        await endpoint.changePop(pop)
        setStatus('Connected. Pick a camera, or drop a video on the preview.')
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
 * The endpoint is dropped before the await rather than after, so nothing can
 * start a camera or a file against a session already on its way out.
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
    loadedFile = undefined
    clearPreview()
    resetTracks()
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

function toggleSection(header) {
    const body = document.getElementById(`section-${header.dataset.section}`)
    body.hidden = !body.hidden
    header.classList.toggle('open', !body.hidden)
}

/*
 * Give the preview back whatever it is holding.
 *
 * getUserMedia() can succeed and everything after it still fail, and an object
 * URL left unrevoked holds the whole file in memory, so both are released on
 * every path that replaces a source.
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
    return Boolean(localVideo.srcObject || localVideo.getAttribute('src'))
}

// A session, because there is nowhere for a file to go without one, and no live
// stream, because one pipeline takes one source.
function canAcceptDrop() {
    return Boolean(endpoint) && !streaming
}

/*
 * Which webcam control is showing, and whether the preview takes a drop.
 *
 * A live stream is the one thing a dropped video cannot share - one pipeline,
 * one source - so the drop target is exactly the complement of it.
 */
function updateSourceControls() {
    webcamSelect.hidden = streaming
    webcamSelect.disabled = streaming || !endpoint || webcamSelect.children.length < 2
    disconnectButton.hidden = !streaming

    const dragging = previewWrapper.classList.contains('dragging')
    dropHint.classList.toggle('show', !streaming && (dragging || !hasPreviewMedia()))
    dropHint.classList.toggle('idle', !canAcceptDrop())
    if (canAcceptDrop()) {
        dropHintTitle.textContent = 'Drop a video here'
        dropHintNote.textContent = 'or click to choose one - a still has no tracks to select from'
    } else {
        dropHintTitle.textContent = 'Connect first, then drop a video here'
        dropHintNote.textContent = 'The Pop runs on a worker, so there is nothing to drop a file into until a session is open.'
    }

    if (streaming) {
        previewNote.textContent = 'Live webcam. Disconnect it to run a video through the same Pop instead.'
    } else if (loadedFile) {
        previewNote.textContent = `${loadedFile.name}. Changing the Pop runs it again; drop another video to replace it.`
    } else {
        previewNote.textContent = ''
    }
}

/*
 * The run a result belongs to.
 *
 * A result stream is cancelled but not awaited, so the loop reading it can get
 * one more turn after its source has been replaced. Every loop carries the token
 * it started with and stops as soon as it is no longer the current one.
 */
let sourceToken = 0

/* ---------- fullscreen ---------- */

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
    } catch (e) {
        setStatus(`Fullscreen refused: ${e.message}`, true)
    }
}

function updateFullscreenButton() {
    const on = fullscreenElement() === previewWrapper
    previewFullscreen.textContent = on ? '⛶ Exit fullscreen' : '⛶ Fullscreen'
    previewFullscreen.title = on ? 'Exit fullscreen' : 'Fullscreen'
    previewFullscreen.setAttribute('aria-label', previewFullscreen.title)
}

function setupFullscreen() {
    previewFullscreen.addEventListener('click', () => toggleFullscreen(previewWrapper))
    // Escape and the browser's own chrome leave fullscreen without going through
    // the button, so the label follows the event rather than the click
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
        document.addEventListener(type, updateFullscreenButton)
    }
    updateFullscreenButton()
}

// The overlay is stretched over the frame, so in fullscreen a frame that is not
// the media's shape would put the overlay beside the picture instead of on it.
function setPreviewAspect(width, height) {
    if (width > 0 && height > 0) {
        previewFrame.style.setProperty('--media-ratio', String(width / height))
    }
}

/* ---------- videos dropped on the preview ---------- */

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
            setStatus('Press Connect first - a video needs a worker session to run on.', true)
        } else if (file) {
            loadFile(file)
        }
        updateSourceControls()
    })

    // a file that misses the target would otherwise be opened by the browser,
    // replacing the page with the very video meant to be tracked
    for (const type of ['dragover', 'drop']) {
        document.addEventListener(type, event => event.preventDefault())
    }
}

function showVideoInPreview(file) {
    clearPreview()
    previewUrl = URL.createObjectURL(file)
    return new Promise((resolve, reject) => {
        localVideo.hidden = false
        localVideo.addEventListener('loadedmetadata', () => resolve({ width: localVideo.videoWidth, height: localVideo.videoHeight }), {
            once: true,
        })
        localVideo.addEventListener('error', () => reject(new Error('the browser could not decode it')), { once: true })
        localVideo.src = previewUrl
        localVideo.load()
    })
}

async function loadFile(file) {
    // a still has no motion to track and no past frame to select, so only a
    // video makes sense here
    if (!file.type.startsWith('video/')) {
        setStatus(`${file.name} is ${file.type || 'of an unknown type'}, not a video.`, true)
        return
    }
    if (!canAcceptDrop()) {
        setStatus('Press Connect first - a video needs a worker session to run on.', true)
        return
    }

    loadedFile = undefined
    let size
    try {
        size = await showVideoInPreview(file)
    } catch (e) {
        updateSourceControls()
        setStatus(`Could not read ${file.name}: ${e.message}`, true)
        return
    }
    loadedFile = file
    updateSourceControls()
    setPreviewAspect(size.width, size.height)
    await processLoadedFile()
}

async function processLoadedFile() {
    if (!loadedFile || !endpoint || streaming) {
        return
    }
    const token = ++sourceToken
    cancelResultStream()
    localVideo.pause()
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)
    // a run of the file is a new set of tracks, numbered from the start again
    resetTracks()
    setStatus(`Processing ${loadedFile.name}...`)

    const file = loadedFile
    let results
    try {
        results = await endpoint.process({ source: { file: file } })
    } catch (e) {
        setStatus(`Could not process ${file.name}: ${e.message}`, true)
        return
    }
    if (token !== sourceToken) {
        results.cancel()
        return
    }
    resultStream = results
    consumeResults(results, token, file)
}

/*
 * Draw a video's results, moving the preview with the live ones.
 *
 * The preview is seeked to each live prediction's own timestamp and only then
 * drawn, so the overlay always belongs to the frame under it. A selected
 * prediction is not seeked to: it carries a past frame's timestamp, and
 * following it would jump the video backwards. Selections flush when the
 * stream ends, so the last few predictions of a file are usually selected ones.
 */
async function consumeResults(results, token, file) {
    let frames = 0
    let selections = 0
    try {
        for await (const result of results) {
            if (token !== sourceToken) {
                return
            }
            if (result.selected) {
                selections += 1
                noteSelectedPrediction(result)
                continue
            }
            frames += 1
            await seekVideo(localVideo, result.seconds ?? 0)
            if (token !== sourceToken) {
                return
            }
            setStatus(`${file.name}: frame ${frames} at ${(result.seconds ?? 0).toFixed(2)} s, ${selections} selections.`)
            noteLivePrediction(result)
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
        setStatus(`${file.name} done: ${frames} frames, ${tracks.size} tracks, ${selections} selections.`)
    }
}

// A seek that never lands would stall the result stream waiting behind it, so
// the wait is bounded and a frame the browser could not produce is simply drawn
// over whichever one it is still showing.
const SEEK_TIMEOUT_MS = 2000

function seekVideo(video, seconds) {
    return new Promise(resolve => {
        const duration = video.duration
        if (!Number.isFinite(duration) || duration <= 0) {
            resolve()
            return
        }
        const target = Math.min(Math.max(seconds, 0), duration - 0.001)
        if (Math.abs(video.currentTime - target) < 0.001) {
            resolve()
            return
        }
        let timer = undefined
        const done = () => {
            clearTimeout(timer)
            video.removeEventListener('seeked', done)
            resolve()
        }
        video.addEventListener('seeked', done)
        timer = setTimeout(done, SEEK_TIMEOUT_MS)
        video.currentTime = target
    })
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
    await startStream(deviceId)
    updateSourceControls()
}

async function startStream(deviceId) {
    const token = ++sourceToken
    cancelResultStream()
    loadedFile = undefined
    clearPreview()
    resetTracks()

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
        localVideo.hidden = false
        localVideo.srcObject = stream
        await localVideo.play()
        setPreviewAspect(localVideo.videoWidth, localVideo.videoHeight)

        resultStream = await endpoint.process({ source: { mediaStream: stream } })
        streaming = true
        setStatus('Streaming. Tracks appear below; their results follow once a track is selected.')
        renderFromResultStream(resultStream, token)
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
    updateSourceControls()
    setStatus('Webcam disconnected. Pick a camera again, or drop a video on the preview. The track list stays until the next source.')
}

document.addEventListener('DOMContentLoaded', setup)
