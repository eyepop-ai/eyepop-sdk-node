import {EyePopSdk, EndpointState} from '@eyepop.ai/eyepop'

import {createCanvas, loadImage} from "canvas"
import {open} from 'openurl'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { pino } from 'pino'
import process from 'process'

const logger = pino({level: 'info', name: 'eyepop-example'})

const example_image_path = process.argv[2]

;(async () => {
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")

    const endpoint = await EyePopSdk.endpoint({
        logger: logger
    }).onStateChanged((fromState:EndpointState, toState:EndpointState) => {
        logger.info("Endpoint changed state %s -> %s", fromState, toState)
    }).connect()
    try {
        let results = await endpoint.process({path: example_image_path})
        for await (let result of await results) {
            canvas.width = result.source_width
            canvas.height = result.source_height
            context.drawImage(image, 0, 0)
            EyePopSdk.plot(context).prediction(result)
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

