import { parseArgs } from 'node:util'
import { pino } from 'pino'
import EyePop, { InferRequest, TranscodeMode } from '@eyepop.ai/eyepop/index'

const logger = pino({ level: "debug", name: "eyepop-example" });

const { positionals, values } = parseArgs({
  options: {
    assetUuid: {
      type: "string",
      short: "a",
      default: undefined
    },
    datasetUuid: {
      type: "string",
      short: "d",
      default: undefined
    },
    model: {
        type: 'string',
        short: "m",
        default: "smol"
    },
    prompt: {
        type: 'string',
        short: "p",
        default: "describe the scene in one sentence."
    }
  }
});

(async (parameters=values) => {
    const endpoint = EyePop.dataEndpoint()
    try {
        await endpoint.connect()
            const inferRequest: InferRequest = {
                text_prompt: parameters.prompt,
                worker_release: parameters.model,
                config: {
                    image_size: 1024
                }
            }
        if (parameters.assetUuid) {
            const asset = await endpoint.getAsset(parameters.assetUuid)
            let inferJob = null
            if (asset.mime_type.startsWith('image/')) {
                inferJob = await endpoint.inferAsset(
                    asset.uuid,
                    inferRequest,
                    undefined,
                    undefined,
                    TranscodeMode.image_cover_1024
                )
            } else if (asset.mime_type.startsWith('video/')) {
                inferJob = await endpoint.inferAsset(asset.uuid, inferRequest, undefined, undefined, TranscodeMode.video_original_size)
            } else {
                console.error(`unsupported asset mime tpe ${asset.mime_type}`)
                return
            }
            for await (let prediction of inferJob) {
                console.log(`result: ${JSON.stringify(prediction)}`)
            }
        } else if (parameters.datasetUuid) {
            const evaluateJob = await endpoint.evaluateDataset({
                dataset_uuid: parameters.datasetUuid,
                infer: inferRequest,
            })
            console.log('evaluate result', JSON.stringify(await evaluateJob.response()))
        } else {
            console.error('either --datasetUuid or --assetUuid required')
        }
    } finally {
        await endpoint.disconnect()
    }

})();





