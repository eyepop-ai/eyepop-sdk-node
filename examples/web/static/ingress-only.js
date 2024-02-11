console.log("Hello EyePop Demo");

let endpoint = undefined;
let startButton = undefined;
let stopButton = undefined;


async function setup() {
    startButton = document.getElementById('start-stream');
    stopButton = document.getElementById('stop-stream');

    startButton.addEventListener('click', startLocalStream);
    stopButton.addEventListener('click', stopStream);
}

async function startLocalStream(event) {
    if (!endpoint) {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const popId = urlParams.get('popId');

        endpoint = await EyePopSdk.endpoint({
            auth: {oAuth2: true},
            popId: popId
        }).onStateChanged((from, to) => {
            console.log("Endpoint state transition from " + from + " to " + to);
        }).connect();
   }

    startButton.disabled = true;
    const stream = await navigator.mediaDevices.getUserMedia({video: true});
    liveIngress = await endpoint.liveIngress(stream);
    stopButton.disabled = false;
}


async function stopStream(event) {
    stopButton.disabled = true;
    await liveIngress.close();
    startButton.disabled = false;
}

document.addEventListener("DOMContentLoaded", async (event) => {
    await setup();
});
