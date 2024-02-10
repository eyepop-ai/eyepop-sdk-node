console.log("Hello EyePop");

let endpoint = undefined;
let popNameElement = undefined;
let startButton = undefined;
let stopButton = undefined;
let timingSpan = undefined;
let resultSpan = undefined;

let liveIngress = undefined;

async function setup() {
    popNameElement = document.getElementById("pop-name");
    startButton = document.getElementById('start-stream');
    stopButton = document.getElementById('stop-stream');
    timingSpan = document.getElementById("timing");
    resultSpan = document.getElementById('txt_json');

    startButton.addEventListener('click', startStream);
    stopButton.addEventListener('click', stopStream);

    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const popId = urlParams.get('popId');

    endpoint = await EyePopSdk.endpoint({
        auth: { oAuth: true },
        popId: popId
    }).onStateChanged((from, to) => {
       console.log("Endpoint state transition from " + from + " to " + to);
    }).onIngressEvent((ingressEvent) => {
       console.log(ingressEvent);
       if (ingressEvent.event == "stream-ready") {
           startLiveInference(ingressEvent.ingressId);
       }
    }).connect();

    popNameElement.innerHTML = endpoint.popName();
    startButton.disabled = false;
}
async function startStream(event) {
    const startTime = performance.now();
    timingSpan.innerHTML = "__ms";
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>";
    startButton.disabled = true;
    const stream = await navigator.mediaDevices.getUserMedia({video: true})
    liveIngress = await endpoint.liveIngress(stream);
    timingSpan.innerHTML = Math.floor(performance.now() - startTime) + "ms";
    stopButton.disabled = false;
}

function startLiveInference(ingressId) {
    endpoint.process({ingressId: ingressId}).then(async (results) => {
        for await (let result of results) {
            resultSpan.textContent = JSON.stringify(result, " ", 2);
        }
    })
}

async function stopStream(event) {
    stopButton.disabled = true;
    await liveIngress.close();
    startButton.disabled = false;
}

document.addEventListener("DOMContentLoaded", async (event) => {
    await setup();
});
