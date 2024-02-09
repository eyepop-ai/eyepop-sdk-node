console.log("Hello EyePop");

let endpoint = undefined;
let context = undefined;
let popNameElement = undefined;
let uploadButton = undefined;
let imagePreview = undefined;
let resultOverlay = undefined;
let timingSpan = undefined;
let resultSpan = undefined;

async function setup() {
    popNameElement = document.getElementById("pop-name");
    uploadButton = document.getElementById('file-upload');
    imagePreview = document.getElementById('image-preview');
    resultOverlay = document.getElementById('result-overlay');
    timingSpan = document.getElementById("timing");
    resultSpan = document.getElementById('txt_json');

    endpoint = await EyePopSdk.endpoint({
        auth: { oAuth: true },
        popId: '09ff30fb09224fe19b2cb11fa3bdccf1'
    }).onStateChanged((from, to) => {
       console.log("Endpoint state transition from " + from + " to " + to);
    }).onIngressEvent((ingressEvent) => {
       console.log(ingressEvent);
    }).connect();

    popNameElement.innerHTML = endpoint.popName();
    uploadButton.disabled = false;
    uploadButton.addEventListener('change', upload);

    context = resultOverlay.getContext("2d");
}
async function upload(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = function () {
        imagePreview.src = reader.result;
        imagePreview.style.display = 'block';
    };

    reader.readAsDataURL(file);

    const startTime = performance.now();
    timingSpan.innerHTML = "__ms";
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>";

    endpoint.upload({file: file}).then(async (results) => {
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

document.addEventListener("DOMContentLoaded", async (event) => {
    await setup();
});
