/*
 * Upload an image or a video and show the raw results.
 *
 * The Pop and the per-source params are both editable as JSON. A file is
 * dropped on the preview, and for a video the preview is stepped to each
 * prediction's timestamp before its overlay is drawn.
 */
import { EyePop, PopComponentType, validatePop } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

// Compose your Pop here, or edit it on the page
const DEFAULT_POP = {
    components: [
        {
            type: PopComponentType.INFERENCE,
            model: 'eyepop.person:latest',
        },
    ],
}

let endpoint = undefined
let renderer = undefined
let resultStream = undefined
let appliedPop = DEFAULT_POP
// ProcessParams sent beside every source, e.g. { roi, fps, camera, componentParams }
let appliedParams = {}

let loadedFile = undefined
let previewUrl = undefined

// The run a result belongs to: a cancelled stream's loop can get one more turn
// after its source is replaced, and must not draw over the new one.
let sourceToken = 0

const popNameElement = document.getElementById('pop-name')
const statusLine = document.getElementById('status')
const timingSpan = document.getElementById('timing')
const resultSpan = document.getElementById('txt_json')
const popJson = document.getElementById('pop-json')
const popError = document.getElementById('pop-error')
const popApply = document.getElementById('pop-apply')
const popRevert = document.getElementById('pop-revert')
const paramsJson = document.getElementById('params-json')
const paramsError = document.getElementById('params-error')
const paramsApply = document.getElementById('params-apply')
const previewWrapper = document.getElementById('preview')
const previewFrame = document.getElementById('preview-frame')
const previewFullscreen = document.getElementById('preview-fullscreen')
const localVideo = document.getElementById('local-video')
const localImage = document.getElementById('local-image')
const overlay = document.getElementById('result-overlay')
const overlayContext = overlay.getContext('2d')
const dropHint = document.getElementById('drop-hint')
const dropHintTitle = document.getElementById('drop-hint-title')
const dropHintNote = document.getElementById('drop-hint-note')
const fileInput = document.getElementById('file-input')
const previewNote = document.getElementById('preview-note')

function setStatus(message, isError) {
    statusLine.textContent = message
    statusLine.className = isError ? 'm-2 text-danger' : 'm-2 text-muted'
}

function showError(element, message) {
    element.textContent = message ?? ''
    element.hidden = !message
}

async function setup() {
    renderer = Render2d.renderer(overlayContext)

    for (const header of document.querySelectorAll('.section-header')) {
        header.addEventListener('click', () => toggleSection(header))
    }
    popJson.value = JSON.stringify(appliedPop, undefined, 2)
    popApply.addEventListener('click', applyPop)
    popRevert.addEventListener('click', () => {
        popJson.value = JSON.stringify(appliedPop, undefined, 2)
        showError(popError)
    })
    paramsApply.addEventListener('click', applyParams)

    setupDropTarget()
    setupFullscreen()
    updateSourceControls()

    try {
        const session = await (await fetch('eyepop-session.json')).json()
        endpoint = EyePop.workerEndpoint({
            auth: { session: session },
        })
        endpoint.onStateChanged((from, to) => {
            console.log('Endpoint state transition from ' + from + ' to ' + to)
        })
        await endpoint.connect()
        popNameElement.textContent = endpoint.popName()
        await endpoint.changePop(appliedPop)
        setStatus('Connected. Drop an image or a video on the preview.')
    } catch (e) {
        endpoint = undefined
        setStatus(`Connect failed: ${e.message}`, true)
    }
    popApply.disabled = !endpoint
    updateSourceControls()
}

function toggleSection(header) {
    const body = document.getElementById(`section-${header.dataset.section}`)
    body.hidden = !body.hidden
    header.classList.toggle('open', !body.hidden)
}

/* ---------- the two editors ---------- */

async function applyPop() {
    let pop
    try {
        pop = JSON.parse(popJson.value)
        validatePop(pop)
    } catch (e) {
        showError(popError, `Pop rejected: ${e.message}`)
        return
    }
    popApply.disabled = true
    try {
        await endpoint.changePop(pop)
    } catch (e) {
        showError(popError, `Could not change the pop: ${e.message}`)
        return
    } finally {
        popApply.disabled = !endpoint
    }
    appliedPop = pop
    showError(popError)
    popJson.value = JSON.stringify(pop, undefined, 2)
    setStatus('Pop changed.')
    await processLoadedFile()
}

async function applyParams() {
    let params
    try {
        params = paramsJson.value.trim() ? JSON.parse(paramsJson.value) : {}
        if (params === null || typeof params !== 'object' || Array.isArray(params)) {
            throw new Error('expected a JSON object')
        }
        // the source is chosen by dropping a file, not by the params
        if ('source' in params) {
            throw new Error('source is set by the dropped file, leave it out')
        }
    } catch (e) {
        showError(paramsError, `Params rejected: ${e.message}`)
        return
    }
    appliedParams = params
    showError(paramsError)
    paramsJson.value = JSON.stringify(params, undefined, 2)
    setStatus('Params applied; they are sent with every source.')
    await processLoadedFile()
}

/* ---------- the preview ---------- */

function canAcceptDrop() {
    return Boolean(endpoint)
}

function hasPreviewMedia() {
    return Boolean(localVideo.getAttribute('src') || localImage.getAttribute('src'))
}

function updateSourceControls() {
    const dragging = previewWrapper.classList.contains('dragging')
    dropHint.classList.toggle('show', dragging || !hasPreviewMedia())
    dropHint.classList.toggle('idle', !canAcceptDrop())
    if (canAcceptDrop()) {
        dropHintTitle.textContent = 'Drop an image or a video here'
        dropHintNote.textContent = 'or click to choose one'
    } else {
        dropHintTitle.textContent = 'Waiting for a session'
        dropHintNote.textContent = 'The Pop runs on a worker, so there is nothing to drop a file into until one is connected.'
    }
    previewNote.textContent = loadedFile
        ? `${loadedFile.name}. Changing the Pop or the params runs it again; drop another file to replace it.`
        : ''
}

function clearPreview() {
    localVideo.pause()
    if (localVideo.getAttribute('src')) {
        localVideo.removeAttribute('src')
        // without a reload the element keeps showing the frame it last decoded
        localVideo.load()
    }
    localImage.removeAttribute('src')
    localImage.hidden = true
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

function setupDropTarget() {
    dropHint.addEventListener('click', () => {
        if (!canAcceptDrop()) {
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

    // dragover has to be cancelled on every event, or drop never fires
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
            // dragleave fires for every child crossed; only leaving the wrapper ends it
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
        if (file && canAcceptDrop()) {
            loadFile(file)
        }
        updateSourceControls()
    })
    // a file that misses the target would otherwise be opened by the browser;
    // only file drags, so text can still be dragged within the editors
    for (const type of ['dragover', 'drop']) {
        document.addEventListener(type, event => {
            if (event.dataTransfer?.types?.includes('Files')) {
                event.preventDefault()
            }
        })
    }
}

function setupFullscreen() {
    previewFullscreen.addEventListener('click', async () => {
        try {
            if ((document.fullscreenElement ?? document.webkitFullscreenElement) === previewWrapper) {
                await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document)
            } else {
                await (previewWrapper.requestFullscreen ?? previewWrapper.webkitRequestFullscreen).call(previewWrapper)
            }
        } catch (e) {
            setStatus(`Fullscreen refused: ${e.message}`, true)
        }
    })
    const update = () => {
        const on = (document.fullscreenElement ?? document.webkitFullscreenElement) === previewWrapper
        previewFullscreen.textContent = on ? '⛶ Exit fullscreen' : '⛶ Fullscreen'
    }
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
        document.addEventListener(type, update)
    }
}

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
    // supersede the running stream and any load still decoding, so neither
    // draws on or claims the preview this file is about to take
    const token = ++sourceToken
    cancelResultStream()
    loadedFile = undefined
    let size
    try {
        size = await showFileInPreview(file, isVideo)
    } catch (e) {
        if (token !== sourceToken) {
            return
        }
        clearPreview()
        updateSourceControls()
        setStatus(`Could not read ${file.name}: ${e.message}`, true)
        return
    }
    if (token !== sourceToken) {
        return
    }
    loadedFile = file
    if (size.width > 0 && size.height > 0) {
        // the overlay is stretched over the frame, so in fullscreen the frame
        // has to keep the media's shape
        previewFrame.style.setProperty('--media-ratio', String(size.width / size.height))
    }
    updateSourceControls()
    await processLoadedFile()
}

async function processLoadedFile() {
    if (!loadedFile || !endpoint) {
        return
    }
    const token = ++sourceToken
    cancelResultStream()
    localVideo.pause()
    overlayContext.clearRect(0, 0, overlay.width, overlay.height)

    const file = loadedFile
    const isVideo = file.type.startsWith('video/')
    document.getElementById('title').textContent = file.name
    timingSpan.textContent = '__ms'
    resultSpan.innerHTML = "<span class='text-muted'>processing</span>"
    setStatus(`Processing ${file.name}...`)

    const startTime = performance.now()
    let results
    try {
        results = await endpoint.process({ ...appliedParams, source: { file: file } })
    } catch (e) {
        if (token === sourceToken) {
            setStatus(`Could not process ${file.name}: ${e.message}`, true)
            resultSpan.textContent = ''
        }
        return
    }
    if (token !== sourceToken) {
        results.cancel()
        return
    }
    resultStream = results

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
            resultSpan.textContent = JSON.stringify(result, undefined, 2)
            // the overlay is stretched over the media by CSS, so it draws in the
            // frame's own coordinates
            overlay.width = result.source_width
            overlay.height = result.source_height
            overlayContext.clearRect(0, 0, overlay.width, overlay.height)
            renderer.draw(result)
        }
    } catch (e) {
        if (token === sourceToken) {
            setStatus(`Result stream ended: ${e.message}`, true)
        }
        return
    }
    if (token !== sourceToken) {
        return
    }
    timingSpan.textContent = Math.floor(performance.now() - startTime) + 'ms'
    if (!frames) {
        setStatus(`The worker returned no prediction for ${file.name}.`, true)
        resultSpan.textContent = ''
    } else {
        setStatus(isVideo ? `${file.name} done: ${frames} frames.` : `${file.name} done.`)
    }
}

// A seek that never lands would stall the result stream behind it, so the wait
// is bounded and the frame is drawn over whatever the browser is showing.
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

await setup()
