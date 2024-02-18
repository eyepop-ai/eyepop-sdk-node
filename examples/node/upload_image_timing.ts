import {EyePop} from '../../src/eyepop'
import process from 'process'

async function upload_photos_sequentially(image_paths: Array<string>) {
    const endpoint = await EyePop.endpoint().connect()
    try {
        for (let i = 0; i < image_paths.length; i++) {
            let results = await endpoint.process({path: image_paths[i]})
            for await (let result of results) {
                // console.log(result)
            }
        }
    } finally {
        await endpoint.disconnect()
    }
}

async function upload_photos_parallel(image_paths: Array<string>) {
    const endpoint = await EyePop.endpoint().connect()
    try {
        for (let i = 0; i < image_paths.length; i++) {
            const job = endpoint.process({path: image_paths[i]})
            job.then(async (results) => {
                for await (let result of results) {
                    // console.log(result)
                }
            })
        }
    } finally {
        await endpoint.disconnect()
    }
}


if (!process.argv[2]) {
    console.error('first argument must be path to an image')
    process.exit(-1)
}
if (!process.argv[3]) {
    console.error('second argument must be the number of iterations')
    process.exit(-1)
}

const example_image_path = process.argv[2]
const num_of_iterations: number = Number.parseInt(process.argv[3])

;(async () => {
    try {
        console.log(`using: ${example_image_path} x ${num_of_iterations} for sequential upload`)
        const example_image_paths = new Array<string>(num_of_iterations)
        example_image_paths.fill(example_image_path)

        let t1 = Date.now()
        await upload_photos_sequentially(example_image_paths)
        let t2 = Date.now()
        console.log(`${example_image_paths.length} x photo sequential took ${(t2 - t1)} seconds`)
    } catch (e) {
        console.error(e)
    }

    try {
        console.log(`using: ${example_image_path} x ${num_of_iterations} for parallel upload`)
        const example_image_paths = new Array<string>(num_of_iterations)
        example_image_paths.fill(example_image_path)

        let t1 = Date.now()
        await upload_photos_parallel(example_image_paths)
        let t2 = Date.now()
        console.log(`${example_image_paths.length} x photo parallel took ${(t2 - t1)} seconds`)
    } catch (e) {
        console.error(e)
    }
})()
