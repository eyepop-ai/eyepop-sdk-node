console.log("Hello EyePop Demo");

let endpoint = undefined;
let context = undefined;
let popNameElement = undefined;
let connectButton = undefined;
let fileChooser = undefined;
let imagePreview = undefined;
let resultOverlay = undefined;
let timingSpan = undefined;
let resultSpan = undefined;

async function setup() {
    popNameElement = document.getElementById("pop-name");
    connectButton = document.getElementById('connect');
    fileChooser = document.getElementById('file-upload');
    imagePreview = document.getElementById('image-preview');
    resultOverlay = document.getElementById('result-overlay');
    timingSpan = document.getElementById("timing");
    resultSpan = document.getElementById('txt_json');

    connectButton.disabled = false;
    connectButton.addEventListener('click', connect);
    fileChooser.addEventListener('change', upload);

    context = resultOverlay.getContext("2d");
}

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
        }).onIngressEvent((ingressEvent) => {
            console.log(ingressEvent);
        }).connect();
    }
    fileChooser.disabled = false;
    popNameElement.innerHTML = endpoint.popName();
}
async function upload(event) {
    const file = fileChooser.files[0];
    const reader = new FileReader();
    reader.onload = function () {
        context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
        imagePreview.src = reader.result;
    };

    reader.readAsDataURL(file);

    const startTime = performance.now();
    timingSpan.innerHTML = "__ms";
    resultSpan.innerHTML = "<span class='text-muted'>processing</a>";

    endpoint.process({file: file}).then(async (results) => {
        for await (let result of results) {
            resultSpan.textContent = JSON.stringify(result, " ", 2);
            resultOverlay.width = result.source_width;
            resultOverlay.height = result.source_height;
            context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
            Render2d.renderer(context,[{
                type: 'face',
                target: '$..objects[?(@.classLabel=="face")]'
            }]).prediction(result);
        }
        timingSpan.innerHTML = Math.floor(performance.now() - startTime) + "ms";
    });
}

document.addEventListener("DOMContentLoaded", async (event) => {
    await setup();
});
