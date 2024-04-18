console.log("Hello EyePop Demo");

let endpoint = undefined;
let context = undefined;
let popNameElement = undefined;
let connectButton = undefined;
let fileChooser = undefined;
let processButton = undefined;
let imagePreview = undefined;
let resultOverlay = undefined;
let roiOverlay = undefined;
let popComp = undefined;
let updatePopComp = undefined;
let timingSpan = undefined;
let resultSpan = undefined;

async function setup() {
    popNameElement = document.getElementById("pop-name");
    connectButton = document.getElementById('connect');
    fileChooser = document.getElementById('file-upload');
    processButton = document.getElementById('process');
    imagePreview = document.getElementById('image-preview');
    resultOverlay = document.getElementById('result-overlay');
    roiOverlay = document.getElementById('roi-overlay');
    popComp = document.getElementById('pop-comp');
    updatePopComp = document.getElementById('update-pop-comp');
    timingSpan = document.getElementById("timing");
    resultSpan = document.getElementById('txt_json');

    connectButton.disabled = false;
    connectButton.addEventListener('click', connect);
    fileChooser.addEventListener('change', fileChanged);
    processButton.addEventListener('click', upload);

    context = resultOverlay.getContext("2d");

    imagePreview.addEventListener('load', (event => {
        console.log(event)
    }))
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
    popComp.value = endpoint.popComp();
    popComp.style.overflow = 'hidden';
    popComp.style.height = 0;
    popComp.style.height = popComp.scrollHeight + 'px';

    popComp.addEventListener('change', async (event) => {
       console.log('pop changed');
       updatePopComp.disabled = false;
    });

    updatePopComp.addEventListener('click', async (event) => {
       console.log('updated');
       updatePopComp.disabled = true;
       await endpoint.changePopComp(popComp.value);
    });
}

async function fileChanged(event) {
    const file = fileChooser.files[0];
    const reader = new FileReader();
    reader.onload = function () {
        context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
        imagePreview.src = reader.result;
        imagePreview.decode().then((i) => {
            resultOverlay.width = imagePreview.naturalWidth;
            resultOverlay.height = imagePreview.naturalHeight;
            roiOverlay.width = imagePreview.naturalWidth;
            roiOverlay.height = imagePreview.naturalHeight;
            initForRoi();
        })
    };

    try {
        reader.readAsDataURL(file);
        processButton.disabled = false;
    } catch (e) {
        console.log(e);
        processButton.disabled = true;
    }
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

    let params = undefined;
    if (roiRect.top || roiPoints.length) {
        params = {
            roi: {}
        };
        if (roiPoints.length) {
            params.roi["points"] = roiPoints;
        }
        if (roiRect.top) {
            params.roi["boxes"] = [{
                topLeft:{
                    x:roiRect.left,
                    y:roiRect.top
                }, bottomRight:{
                    x:roiRect.right,
                    y:roiRect.bottom
                }
            }];
        }
    }
    endpoint.process({file: file}, params=params).then(async (results) => {
        for await (let result of results) {
            resultSpan.textContent = JSON.stringify(result, " ", 2);
            context.clearRect(0,0,resultOverlay.width, resultOverlay.height);
            const renderer = Render2d.renderer(context,[
              Render2d.renderMask(),
              Render2d.renderContour(),
              Render2d.renderKeypoints(),
              // Render2d.renderBox()
            ]);
            renderer.draw(result);
            initForRoi();
        }
        timingSpan.innerHTML = Math.floor(performance.now() - startTime) + "ms";
    });
}

document.addEventListener("DOMContentLoaded", async (event) => {
    await setup();
});
