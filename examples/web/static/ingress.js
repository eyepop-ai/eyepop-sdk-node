console.log("Hello EyePop Demo");

let endpoint = undefined;
let popNameElement = undefined;
let connectButton = undefined;
let startButton = undefined;
let stopButton = undefined;
let timingSpan = undefined;
let resultSpan = undefined;

let localVideo = undefined;
let localResultOverlay = undefined;
let localOverlayContext = undefined;
let remoteVideo = undefined;
let remoteResultOverlay = undefined;
let remoteOverlayContext = undefined;

let liveIngress = undefined;
let liveEgress = undefined;

async function setup() {
    popNameElement = document.getElementById("pop-name");
    connectButton = document.getElementById('connect');
    startButton = document.getElementById('start-stream');
    stopButton = document.getElementById('stop-stream');
    timingSpan = document.getElementById("timing");
    resultSpan = document.getElementById('txt_json');

    localVideo = document.getElementById('local-video');
    localResultOverlay = document.getElementById('local-result-overlay');
    localOverlayContext = localResultOverlay.getContext("2d");

    remoteVideo = document.getElementById('remote-video');
    remoteResultOverlay = document.getElementById('remote-result-overlay');
    remoteOverlayContext = remoteResultOverlay.getContext("2d");

    connectButton.addEventListener('click', connect);
    startButton.addEventListener('click', startLocalStream);
    stopButton.addEventListener('click', stopStream);

    document.getElementById('share-link').href = document.location.href.replace('ingress.html', 'ingress-only.html')
    connectButton.disabled = false;
    await populateDevices();
}

async function populateDevices() {
    return navigator.mediaDevices.enumerateDevices()
        .then((devices) => {
            for (const device of devices) {
                console.log(device);
                switch (device.kind) {
                    case 'videoinput':
                    {
                        const opt = document.createElement('option');
                        opt.value = device.deviceId;
                        opt.text = device.label;
                        document.getElementById('video_device').appendChild(opt);
                    }
                        break;
                }
            }

            // add screen
            const opt = document.createElement('option');
            opt.value = "screen";
            opt.text = "screen";
            document.getElementById('video_device').appendChild(opt);

            // set default
            document.getElementById('video_device').value = document.getElementById('video_device').children[1].value;
        });
};

async function connect(event) {
    if (!endpoint) {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const popId = urlParams.get('popId');
        const eyepopUrl = urlParams.get('eyepopUrl') || undefined;

        endpoint = await EyePop.endpoint({
            auth: {oAuth2: true},
            popId: popId,
            eyepopUrl: eyepopUrl
        }).onStateChanged((from, to) => {
            console.log("Endpoint state transition from " + from + " to " + to);
        }).onIngressEvent(async (ingressEvent) => {
            console.log(ingressEvent);
            if (ingressEvent.event == 'stream-ready') {
                await startRemoteStream(ingressEvent.ingressId);
                startLiveInference(ingressEvent.ingressId);
            } else {
                if (liveEgress && liveEgress.ingressId() == ingressEvent.ingressId) {
                    remoteVideo.pause();
                    remoteVideo.srcObject = null;
                    remoteOverlayContext.clearRect(0,0,remoteResultOverlay.width, remoteResultOverlay.height);
                    liveEgress = null;
                }
            }
        }).connect();
   }
   popNameElement.innerHTML = endpoint.popName();
   startButton.disabled = false;
}

async function startRemoteStream(ingressId) {
    liveEgress = await endpoint.liveEgress(ingressId);
    remoteVideo.srcObject = await liveEgress.stream();
    remoteVideo.play();
}
async function startLocalStream(event) {
    const startTime = performance.now();
    timingSpan.innerHTML = "__ms";
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>";
    startButton.disabled = true;
    const videoId = document.getElementById('video_device').value;
    let stream = undefined;
    if (videoId == 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
                cursor: "always",
            },
            audio: false,
        })
    } else {
        stream = await navigator.mediaDevices.getUserMedia({video: {deviceId: videoId}});
    }
    localVideo.srcObject = stream;
    localVideo.play();
    liveIngress = await endpoint.liveIngress(stream);
    timingSpan.innerHTML = Math.floor(performance.now() - startTime) + "ms";
    stopButton.disabled = false;
}

function startLiveInference(ingressId) {
    endpoint.process({ingressId: ingressId}).then(async (results) => {
        const remoteRender = Render2d.renderer(remoteOverlayContext,[
          Render2d.renderFace(), Render2d.renderHand()
        ])
        const localRender = Render2d.renderer(localOverlayContext, [
          Render2d.renderTrail(1.0,
            '$..points[?(@.classLabel.includes("nose"))]'),
        ])
        for await (let result of results) {
            resultSpan.textContent = JSON.stringify(result, " ", 2);

            if (localVideo.srcObject) {
                localResultOverlay.width = result.source_width;
                localResultOverlay.height = result.source_height;
                localOverlayContext.clearRect(0, 0, localResultOverlay.width, localResultOverlay.height);
                localRender.draw(result);
            }

            if (remoteVideo.srcObject) {
                remoteResultOverlay.width = result.source_width;
                remoteResultOverlay.height = result.source_height;
                remoteOverlayContext.clearRect(0, 0, remoteResultOverlay.width, remoteResultOverlay.height);
                remoteRender.draw(result);
            }
        }
    })
}

async function stopStream(event) {
    stopButton.disabled = true;
    localVideo.pause();
    localVideo.srcObject = null;
    localOverlayContext.clearRect(0,0,localResultOverlay.width, localResultOverlay.height);
    await liveIngress.close();
    liveIngress = null;
    startButton.disabled = false;
}

document.addEventListener("DOMContentLoaded", async (event) => {
    await setup();
});
