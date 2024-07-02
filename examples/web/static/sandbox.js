import { pino } from 'https://cdn.skypack.dev/pino';

const logger = pino({
    level: 'debug',
    prettyPrint: {
        colorize: true,
        translateTime: true,
    }
});

document.addEventListener("DOMContentLoaded", () =>
{
    const log = console.log;
    let endpoint = undefined;

    let popId = "";
    let apiKey = "";
    let isStaging = false;
    let isSandbox = false;


    const inferStringInput = document.getElementById("infer-string");
    const modelManifestInput = document.getElementById("model-manifest");
    const modelListInput = document.getElementById("models-list");
    const consoleOutputInput = document.getElementById("console-output");
    const runButton = document.getElementById("submit-button");
    const populateButton = document.getElementById("populate-button");
    const popIdInput = document.getElementById("pop-id");

    const apiKeyInput = document.getElementById("pop-key");
    const stagingCheckbox = document.getElementById("staging-checkbox");
    const sandboxCheckbox = document.getElementById("sandbox-checkbox");


    console.log("EyePop Sandbox Example");

    console.log = (...args) =>
    {
        logger.info(args);

        consoleOutputInput.value += args.join(" ") + "\n";
    };
    console.warn = (...args) =>
    {
        consoleOutputInput.value += "--Warning--: " + args.join(" ") + "\n";
    };

    consoleOutputInput.value = "Console Output: \n";
    popIdInput.value = `transient`;
    modelManifestInput.value = JSON.stringify(
        [
            // { "authority": "legacy", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/legacy/1.2.0/manifest.json" },
            // { "authority": "Mediapipe", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/Mediapipe/1.3.0/manifest.json" },
            // { "authority": "yolov5", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov5/1.0.2/manifest.json" },
            // { "authority": "yolov7", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov7/1.0.1/manifest.json" },
            // { "authority": "yolov8", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov8/1.0.1/manifest.json" },
            // { "authority": "PARSeq", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/PARSeq/1.0.1/manifest.json" },
            // { "authority": "mobilenet", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/mobilenet/1.0.1/manifest.json" },
            // { "authority": "eyepop-person", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epperson/1.0.2/manifest.json" },
            // { "authority": "eyepop-animal", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epanimal/1.0.2/manifest.json" },
            // { "authority": "eyepop-device", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epdevice/1.0.2/manifest.json" },
            // { "authority": "eyepop-sports", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epsports/1.0.2/manifest.json" },
            // { "authority": "eyepop-vehicle", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epvehicle/1.0.2/manifest.json" },
            // { "authority": "eyepop-coco", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epcoco/1.0.2/manifest.json" },
            // { "authority": "eyepop-age", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epage/0.2.0/manifest.json" },
            // { "authority": "eyepop-gender", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epgender/0.2.0/manifest.json" },
            // { "authority": "eyepop-expression", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/epexpression/0.2.0/manifest.json" },
            // { "authority": "PARSeq", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/PARSeq/1.0.2/manifest.json" },
            //{ "authority": "eyepop-text", "manifest": "https://s3.amazonaws.com/models.eyepop.ai/releases/eptext/1.0.3/manifest.json" },
            { "authority": "RapidMedical", "manifest": "s3://models.eyepop.ai/releases/rapidmedical/0.5.0/manifest.json" },

            
        ], null, 4
    );

    inferStringInput.value = `
        ep_infer id=1 category-name="text" 
        model=preview:rapidmedical_bag_detector_TorchScriptCuda_float32 
    `;

    modelListInput.value = JSON.stringify([ {
        'model_id': 'preview:rapidmedical_bag_detector_TorchScriptCuda_float32',
        'dataset': 'Sample_Dataset',
        'format': 'TorchScriptCuda',
        'type': 'float32'
    } ], null, 4);


    const connectPop = async () =>
    {
        const auth = apiKey ? { secretKey: apiKey } : { oAuth2: true };
        console.log("Connecting to EyePop...", auth?.apiKey, auth?.oAuth2,)
        return await EyePop.endpoint({
            isSandbox: isSandbox,
            auth: auth,
            popId: popId,
            eyepopUrl: isStaging ? "https://staging-api.eyepop.ai" : "https://eyepop.ai"
        }).connect();
    }

    const getPopData = async () =>
    {
        try
        {

            console.log("Connecting to EyePop...");

            endpoint = await connectPop();

            let manifest = await endpoint.manifest();

            console.log('EyePop Manifest: ', manifest);

            modelManifestInput.value = JSON.stringify(manifest, null, 4);

            let inferString = endpoint.popComp();

            console.log('EyePop Infer String: ', inferString);

            inferStringInput.value = inferString;

            let modelList = await endpoint.models();

            modelListInput.value = JSON.stringify(modelList, null, 4);


        } catch (e)
        {
            console.warn(e);
            alert("Error: " + e);
        }
        finally
        {

            // console.log("Disconnecting to EyePop.");
            // endpoint.disconnect();

        }
    }

    const updatePopData = async () =>
    {
        try
        {
            console.log("Connecting to EyePop...");

            endpoint = await connectPop();

            const manifest = JSON.parse(modelManifestInput.value);

            console.log('EyePop Manifest: ', JSON.stringify(manifest));

            await endpoint.changeManifest(manifest);

            let modelsList = JSON.parse(modelListInput.value);

            console.log('Loading models: ', JSON.stringify(modelsList));

            console.log('.....Loaded models: ', JSON.stringify(await endpoint.models()));

            for (let model of modelsList)
            {
                console.log("Loading model: ", JSON.stringify(model));
                await endpoint.loadModel(model);
            }

            await endpoint.changePopComp(inferStringInput.value);
        } catch (e)
        {
            console.warn(e);
            alert("Error: " + e);
        }
        finally
        {
            // console.log("Disconnecting to EyePop.");
            // endpoint.disconnect();
        }

    }

    populateButton.addEventListener("click", () =>
    {
        consoleOutputInput.value = "Console Output: \n";
        popId = popIdInput.value;
        apiKey = apiKeyInput.value;
        console.log("Pop ID: ", popId);
        console.log("Pop Key: ", apiKey);

        getPopData();
    });

    stagingCheckbox.addEventListener("change", () =>
    {
        isStaging = !isStaging;
    });

    sandboxCheckbox.addEventListener("change", () =>
    {
        isSandbox = !isSandbox;
    });

    runButton.addEventListener("click", () =>
    {
        popId = popIdInput.value;
        apiKey = apiKeyInput.value;

        console.log("Pop ID: ", popId);

        updatePopData();
    });



});
