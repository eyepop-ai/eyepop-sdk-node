console.log("Hello EyePop Demo");

let endpoint = undefined;
let startButton = undefined;
let stopButton = undefined;


async function setup() {
    startButton = document.getElementById('start-stream');
    stopButton = document.getElementById('stop-stream');

    startButton.addEventListener('click', startLocalStream);
    stopButton.addEventListener('click', stopStream);

    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(async () => Promise.all([
            await populateDevices(),
        ]));
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

async function startLocalStream(event) {
    if (!endpoint) {
        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const popId = urlParams.get('popId');
        const eyepopUrl = urlParams.get('eyepopUrl') || undefined;

        endpoint = await EyePopSdk.endpoint({
            auth: {oAuth2: true},
            popId: popId,
            eyepopUrl: eyepopUrl
        }).onStateChanged((from, to) => {
            console.log("Endpoint state transition from " + from + " to " + to);
        }).connect();
   }

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
