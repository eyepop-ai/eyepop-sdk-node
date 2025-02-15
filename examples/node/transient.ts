import { EndpointState, EyePop, ForwardOperatorType, InferenceType, PopComponentType, TransientPopId } from '@eyepop.ai/eyepop'
import { Render2d, RenderText } from '@eyepop.ai/eyepop-render-2d'

import { createCanvas, loadImage } from 'canvas'
import { open } from 'openurl'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { pino } from 'pino'
import process from 'process'

const logger = pino({ level: 'debug', name: 'eyepop-example' })

const example_image_path = process.argv[2]

;(async () => {
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')

    const endpoint = await EyePop.workerEndpoint({
        popId: TransientPopId.Transient,
        logger: logger,
    })
        .onStateChanged((fromState: EndpointState, toState: EndpointState) => {
            logger.info('Endpoint changed state %s -> %s', fromState, toState)
        })
        .connect()
    try {
        await endpoint.changePop({
            components: [
                {
                    type: PopComponentType.INFERENCE,
                    inferenceTypes: [InferenceType.OBJECT_DETECTION],
                    modelUuid: 'yolov7:YOLOv7-TINY_COCO_TensorFlowLite_float32',
                },
                {
                    type: PopComponentType.INFERENCE,
                    inferenceTypes: [InferenceType.OBJECT_DETECTION],
                    modelUuid: 'eyepop-text:EPTextB1_Text_TorchScriptCpu_float32',
                    forward: {
                        operator: {
                            type: ForwardOperatorType.CROP,
                        },
                        targets: [
                            {
                                type: PopComponentType.INFERENCE,
                                inferenceTypes: [InferenceType.OCR],
                                modelUuid: 'PARSeq:PARSeq224_TextDataset_TorchScriptCpu_float32',
                            },
                        ],
                    },
                },
            ],
        })
        let results = await endpoint.process({ path: example_image_path })
        for await (let result of results) {
            canvas.width = result.source_width
            canvas.height = result.source_height
            context.drawImage(image, 0, 0)
            Render2d.renderer(context, [Render2d.renderBox(), Render2d.renderText()]).draw(result)
        }
        const tmp_dir = mkdtempSync(join(tmpdir(), 'ep-demo-'))
        const temp_file = join(tmp_dir, 'out.png')
        logger.info(`creating temp file: %s`, temp_file)

        const buffer = canvas.toBuffer('image/png')
        writeFileSync(temp_file, buffer)

        open(`file://${temp_file}`)
    } catch (e) {
        console.error(e)
    } finally {
        await endpoint.disconnect()
    }
})()
