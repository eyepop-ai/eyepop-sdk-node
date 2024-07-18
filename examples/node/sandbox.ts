import {EndpointState, EyePop, ModelFormat, ModelInstanceDef, ModelType, SourcesEntry, TransientPopId} from '@eyepop.ai/eyepop'
import {Render2d} from '@eyepop.ai/eyepop-render-2d'

import {createCanvas, loadImage} from "canvas"
import {open} from 'openurl'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

import {pino} from 'pino'
import process from 'process';

const logger = pino({level: 'debug', name: 'eyepop-example'})

const example_image_path = process.argv[2]

;(async () => {
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")

    const endpoint = await EyePop.workerEndpoint({
        isSandbox: true,
        popId: TransientPopId.Transient,
        logger: logger
    }).onStateChanged((fromState: EndpointState, toState: EndpointState) => {
        logger.info("Endpoint changed state %s -> %s", fromState, toState)
    }).connect()
    try {
        const entry: SourcesEntry = {
            authority: "yolov7",
            manifest: "https://s3.amazonaws.com/models.eyepop.ai/releases/yolov7/1.0.1/manifest.json"
        }

        const modelDef: ModelInstanceDef = {
            model_id: "yolov7:YOLOv7-TINY",
            dataset: "COCO",
            version: undefined,
            format: ModelFormat.TensorFlowLite,
            type: ModelType.float32
        }
        await endpoint.changeManifest([entry])
        const modelInstance = await endpoint.loadModel(modelDef)
        await endpoint.changePopComp(`ep_infer model="${modelInstance['id']}"`)
        let results = await endpoint.process({path: example_image_path})
        for await (let result of results) {
            canvas.width = result.source_width
            canvas.height = result.source_height
            context.drawImage(image, 0, 0)
            Render2d.renderer(context).draw(result)
        }
    } finally {
        await endpoint.disconnect()
    }

    const tmp_dir = mkdtempSync(join(tmpdir(), 'ep-demo-'))
    const temp_file = join(tmp_dir, 'out.png')
    logger.info(`creating temp file: %s`, temp_file)

    const buffer = canvas.toBuffer('image/png')
    writeFileSync(temp_file, buffer)

    open(`file://${temp_file}`)
})()

