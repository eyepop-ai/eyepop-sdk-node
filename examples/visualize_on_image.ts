import {EyePopSdk} from '../src'

import {createCanvas, loadImage} from "canvas"
import {open} from 'openurl'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const example_image_path = 'examples/example.jpg';

(async () => {
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)
    const plot = EyePopSdk.plot(context)

    const endpoint = await EyePopSdk.endpoint().connect()
    try {
        let results = await endpoint.upload({filePath: example_image_path})
        for await (let result of await results) {
            plot.prediction(result)
        }
    } finally {
        await endpoint.disconnect()
    }

    const tmp_dir = mkdtempSync(join(tmpdir(), 'ep-demo-'))
    const temp_file = join(tmp_dir, 'out.png')
    console.log(`creating temp file: ${temp_file}`)

    const buffer = canvas.toBuffer('image/png')
    writeFileSync(temp_file, buffer)

    open(`file://${temp_file}`)
})()

