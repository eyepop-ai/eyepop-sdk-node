import {EyePopSdk} from "../src";

async function upload_photos_sequentially(image_paths: Array<string>) {
    const endpoint = EyePopSdk.endpoint()
    try {
        await endpoint.connect()
        for (let i = 0; i < image_paths.length; i++) {
            let job = await endpoint.upload({filePath: image_paths[i]})
            for await (let result of await job.results()) {
                // console.log(result)
            }
        }
    } finally {
        await endpoint.disconnect()
    }
}

async function upload_photos_parallel(image_paths: Array<string>) {
    const endpoint = EyePopSdk.endpoint()
    let jobs = new Array()
    try {
        await endpoint.connect()
        for (let i = 0; i < image_paths.length; i++) {
            jobs.push(await endpoint.upload({filePath: image_paths[i]}))
        }
        console.log('done scheduling')
        for (let i = 0; i < jobs.length; i++) {
            for await (let result of await jobs[i].results()) {
                // console.log(result)
            }
        }
    } finally {
        await endpoint.disconnect()
    }
}


(async() => {
    try {
        const example_image_path = './examples/example.jpg'
        const num_of_iterations = 100
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
        const example_image_path = './examples/example.jpg'
        const num_of_iterations = 100
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
