console.log('Hello EyePop Multi-Image Group Demo')

const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error',
}

let endpoint = undefined
let connectionState = ConnectionState.DISCONNECTED
let popNameElement = undefined
let connectionStatusElement = undefined
let abilityInput = undefined
let connectButton = undefined
let fileChooser = undefined
let processButton = undefined
let fileListSpan = undefined
let timingSpan = undefined
let resultSpan = undefined

async function setup() {
    popNameElement = document.getElementById('pop-name')
    connectionStatusElement = document.getElementById('connection-status')
    abilityInput = document.getElementById('ability')
    connectButton = document.getElementById('connect')
    fileChooser = document.getElementById('file-upload')
    processButton = document.getElementById('process')
    fileListSpan = document.getElementById('file-list')
    timingSpan = document.getElementById('timing')
    resultSpan = document.getElementById('txt_json')

    connectButton.addEventListener('click', connect)
    fileChooser.addEventListener('change', filesChanged)
    processButton.addEventListener('click', processGroup)

    setConnectionState(ConnectionState.DISCONNECTED)
}

function setConnectionState(state, detail) {
    connectionState = state
    const selectedFileCount = fileChooser ? fileChooser.files.length : 0

    switch (state) {
        case ConnectionState.CONNECTING:
            connectButton.textContent = 'Connecting…'
            connectButton.disabled = true
            connectionStatusElement.textContent = detail ? `Connecting (${detail})` : 'Connecting…'
            connectionStatusElement.className = 'badge text-bg-warning'
            fileChooser.disabled = true
            processButton.disabled = true
            break
        case ConnectionState.CONNECTED:
            connectButton.textContent = 'Reconnect'
            connectButton.disabled = false
            connectionStatusElement.textContent = 'Connected'
            connectionStatusElement.className = 'badge text-bg-success'
            fileChooser.disabled = false
            processButton.disabled = selectedFileCount < 2
            break
        case ConnectionState.ERROR:
            connectButton.textContent = 'Connect'
            connectButton.disabled = false
            connectionStatusElement.textContent = `Error: ${detail || 'connection failed'}`
            connectionStatusElement.className = 'badge text-bg-danger'
            fileChooser.disabled = true
            processButton.disabled = true
            break
        case ConnectionState.DISCONNECTED:
        default:
            connectButton.textContent = 'Connect'
            connectButton.disabled = false
            connectionStatusElement.textContent = 'Disconnected'
            connectionStatusElement.className = 'badge text-bg-secondary'
            fileChooser.disabled = true
            processButton.disabled = true
            break
    }
}

async function connect(event) {
    const reconnecting = connectionState === ConnectionState.CONNECTED
    setConnectionState(ConnectionState.CONNECTING, reconnecting ? 'reconnecting' : undefined)

    if (reconnecting && endpoint) {
        try {
            await endpoint.disconnect()
        } catch (e) {
            console.log('error while disconnecting previous endpoint', e)
        }
        endpoint = undefined
    }

    try {
        const auth = apiKey ? { apiKey: apiKey } : { oAuth2: true }
        endpoint = await EyePop.workerEndpoint({
            auth: auth,
        }).onStateChanged((from, to) => {
            console.log('Endpoint state transition from ' + from + ' to ' + to)
            if (connectionState === ConnectionState.CONNECTING) {
                setConnectionState(ConnectionState.CONNECTING, to)
            }
        })
        await endpoint.connect()
        await endpoint.changePop({
            components: [{
                type: PopComponentType.INFERENCE,
                ability: abilityInput.value,
            }]
        })
        popNameElement.innerHTML = endpoint.popName()
        setConnectionState(ConnectionState.CONNECTED)
    } catch (e) {
        console.error(e)
        endpoint = undefined
        setConnectionState(ConnectionState.ERROR, e.message)
    }
}

function filesChanged(event) {
    const files = Array.from(fileChooser.files)
    fileListSpan.textContent = files.length ? files.map(f => f.name).join(', ') : 'none'
    processButton.disabled = connectionState !== ConnectionState.CONNECTED || files.length < 2
}

async function processGroup(event) {
    if (connectionState !== ConnectionState.CONNECTED) {
        resultSpan.textContent = 'Not connected. Click Connect first.'
        return
    }

    const files = Array.from(fileChooser.files)
    if (files.length < 2) {
        resultSpan.textContent = 'Select at least two images to form a group.'
        return
    }

    const startTime = performance.now()
    timingSpan.innerHTML = '__ms'
    resultSpan.textContent = 'processing'

    const mimeTypes = files.map(f => f.type || 'application/octet-stream')
    const results = await endpoint.uploadStreamGroup(files, mimeTypes)
    for await (const result of results) {
        resultSpan.textContent = JSON.stringify(result, null, 2)
    }
    timingSpan.innerHTML = Math.floor(performance.now() - startTime) + 'ms'
}

document.addEventListener('DOMContentLoaded', async event => {
    await setup()
})
