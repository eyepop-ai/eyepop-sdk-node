import {createCanvas, loadImage} from "canvas"
import {open} from 'openurl'

import {EyePopSdk} from "../src"
import {EyePopPlot} from "../src/visualize"
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

(async () => {
    const example_image_path = './examples/example.jpg'
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)
    const plot = new EyePopPlot(context)
    const endpoint = EyePopSdk.endpoint()
    try {
        await endpoint.connect()
        let job = await endpoint.upload({filePath: example_image_path})
        for await (let result of await job.results()) {
            console.log(result)
            for (let i = 0; i < result.objects.length; i++) {
                const obj = result.objects[i]
                plot.object(obj)
            }
        }

        const tmp_dir = mkdtempSync(join(tmpdir(), 'ep-demo-'))
        const temp_file = join(tmp_dir, 'out.png')
        console.log(`creating temp file: ${temp_file}`)

        const buffer = canvas.toBuffer('image/png')
        writeFileSync(temp_file, buffer)

        open(`file://${temp_file}`)
    } catch (e) {
        console.error(e)
    } finally {
        await endpoint.disconnect()
    }

})()

