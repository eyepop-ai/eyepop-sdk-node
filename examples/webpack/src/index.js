import {EyePopSdk} from '@eyepop.ai/eyepop';

let endpoint = undefined;
let context = undefined;

const popNameElement = document.getElementById("pop-name");
const uploadButton = document.getElementById('file-upload');
const imagePreview = document.getElementById('image-preview');
const resultOverlay = document.getElementById('result-overlay');
const timingSpan = document.getElementById("timing");
const resultSpan = document.getElementById('txt_json');


async function setup() {
    const session = await (await fetch("eyepop-session.json")).json()
    endpoint = EyePopSdk.endpoint({
        auth: {session: session}
    })
    endpoint.onStateChanged((from, to) => {
       console.log("Endpoint state transition from " + from + " to " + to);
    });
    await endpoint.connect();
    popNameElement.innerHTML = endpoint.popName();
    uploadButton.disabled = false;
    uploadButton.addEventListener('change', upload);

    context = resultOverlay.getContext("2d");
}

async function upload(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = function () {
        context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
        imagePreview.src = reader.result;
    };

    reader.readAsDataURL(file);

    const startTime = performance.now();
    timingSpan.innerHTML = "__ms";
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>";
    context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
    endpoint.process({file: file}).then(async (results) => {
        for await (let result of results) {
            resultSpan.textContent = JSON.stringify(result, " ", 2);
            resultOverlay.width = result.source_width;
            resultOverlay.height = result.source_height;
            context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
            EyePopSdk.plot(context).prediction(result);
        }
        timingSpan.innerHTML = Math.floor(performance.now() - startTime) + "ms";
    });
}

await setup();
