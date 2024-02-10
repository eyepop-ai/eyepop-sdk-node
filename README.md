# EyePop.ai Node SDK
The EyePop.ai Node SDK provides convenient access to the EyePop.ai's inference API from applications written in the 
TypeScript or JavaScript language.
## Installation
```shell
npm install --save @eyepop.ai/eyepop
```
## Configuration
The EyePop SDK needs to be configured with the __Pop Id__ and your __Authentication Credentials__. Credentials can 
be provided as:
1. __Api Key__, server side only because this key must be kept secret
2. __Session generated from Api Key__, server side generated session transported to client over trusted channel
3. __Current Browser Session__, for developer running client code in the same browser session loghed into their EyePop Dashboard.
### Configuration via Environment (Server Side)
While you can provide a secret_key keyword argument, we recommend using dotenv to add EYEPOP_SECRET_KEY="My API Key" 
to your .env file so that your API Key is not stored in source control. By default, the SDK will read the following environment variables:
* `EYEPOP_POP_ID`: The Pop Id to use as an endpoint. You can copy and paste this string from your EyePop Dashboard in the Pop -> Settings section.
* `EYEPOP_SECRET_KEY`: Your Secret Api Key. You can create Api Keys in the profile section of your EyePop dashboard.
* `EYEPOP_URL`: (Optional) URL of the EyePop API service, if you want to use any other endpoint than production `http://api.eyepop.ai`  
### Authentication with Api Key
Configuration and authorization with explicit defaults:
```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'
(async() => {
    const endpoint = EyePopSdk.endpoint({
        // This is the default and can be omitted
        popId: process.env['EYEPOP_POP_ID'],
        // This is the default and can be omitted
        auth : {secretKey: process.env['EYEPOP_SECRET_KEY']},
    })
    await endpoint.connect()
    // do work ....
    await endpoint.disconnect()
})
```
Equivalent, but shorter:
```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'
(async() => {
    const endpoint = EyePopSdk.endpoint()
    await endpoint.connect()
    // do work ....
    await endpoint.disconnect()
})
```
### Authentication with session generated from Api Key
#### Server Side
```javascript
import { EyePopSdk } from '@eyepop.ai/eyepop'
const getSession = async function (req, res) {
    const endpoint = await EyePopSdk.endpoint().connect();
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(await endpoint.session()));
};
const server = http.createServer(getSession);
server.listen(8080, '127.0.0.1');
```
#### Client Side 
```javascript
import { EyePopSdk } from '@eyepop.ai/eyepop'
(async() => {
    const session = await (await fetch("http://127.0.0.1:8080")).json();
    const endpoint = await EyePopSdk.endpoint({ auth: { session: session } }).connect();
    // do work ....
    await endpoint.disconnect();
});
```
### Authentication with Current Browser Session
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop/dist/eyepop.min.js"></script>
</head>
<body>
<script>
    document.addEventListener("DOMContentLoaded", async (event) => {
        let endpoint = await EyePopSdk.endpoint({ auth: { oAuth2: true }, popId: '< Pop Id>' }).connect();
        // do work ....
        await endpoint.disconnect();
    });
</script>
</body>
```
To use an alternative environment, e.g. STAGING vs PRODUCTION, pass in the adjusted Auth0 configuration:
```javascript
// ...
let endpoint = await EyePopSdk.endpoint({ 
  auth: { oAuth2: {
    audience: "https://dev-app.eyepop.ai",
    domain: "dev-eyepop.us.auth0.com",
    clientId: "jktx3YO2UnbkNPvr05PQWf26t1kNTJyg"
  } }, popId: '< Pop Id>' }).connect();
// ...
```
## Usage Examples
### Uploading and processing one single image
```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'

const example_image_path = 'examples/example.jpg';

(async() => {
    const endpoint = await EyePopSdk.endpoint().connect()
    try {
        let results = await endpoint.process({path: example_image_path})
        for await (let result of results) {
            console.log(result)
        }        
    } finally {
        await endpoint.disconnect()
    }
})
```
1. `EyePopSdk.endpoint()` returns a local endpoint object, that will authenticate with the Api Key found in 
EYEPOP_SECRET_KEY and load the worker configuration for the Pop identified by EYEPOP_POP_ID. 
2. Call `endpoint.connect()` before any job is submitted and `endpoint.disconnect()` to release all resources.
3. `endpoint.process({path:'examples/example.jpg'})` initiates the upload to the local file to the worker service. 
The image will be queued and processed immediately when the worker becomes available.
The result of endpoint.upload() implements `AsyncIterable<Prediction>` which can be iterated with 'for await' as 
shown in the example above. Predictions will become available when the submitted file becomes processed by the worker 
and results are efficiently streamed back to the calling client. If the uploaded file is a video
e.g. 'video/mp4' or image container format e.g. 'image/gif', the client will receive one prediction per image frame 
until the entire file has been processed.

4. Alternatively to `path` process() also accepts a readable stream with a mandatory mime-type:
```typescript
    // ... 
    let stream = fs.createReadStream(example_image_path)    
    endpoint.upload({stream: readableStream, mimeType: 'image/jpeg'})
    // ...
```
### Visualizing Results
The EyePop SDK includes helper classes to visualize the predictions for images using `canvas.CanvasRenderingContext2D`.
```typescript
import {createCanvas, loadImage} from "canvas"
import {open} from 'openurl'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EyePopSdk } from '@eyepop.ai/eyepop'

const example_image_path = 'examples/example.jpg';
    
(async() => {
    const image = await loadImage(example_image_path)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)

    const endpoint = await EyePopSdk.endpoint().connect()
    try {
        let results = await endpoint.process({path: example_image_path})
        for await (let result of results) {
            EyePopSdk.plot(context).prediction(result)
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
})
```
### Asynchronous uploading and processing of images
The above _synchronous_ way, process() then iterate all results, is great for individual images or reasonable 
sized batches. For larger batch sizes, or continuous stream of images, don't `await` the results but instead 
use `then()` on the returned promise.
```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'

const example_image_path = 'examples/example.jpg';

(async() => {
    const endpoint = await EyePopSdk.endpoint().connect()
    try {
        for (let i = 0; i < 100; i++) {
            endpoint.process({path: example_image_path}).then(async (results) => {
                for await (let result of results) {
                    console.log(`result for #${i}`, result)
                }
            })
        }
    } finally {
        await endpoint.disconnect()
    }
})
```
This will result in a most efficient processing, i.e. uploads will be processed in parallel (up to five HTTP 
connections per endpoint) and results will be processed by your code as soon as they are available.     
### Loading images from URLs
Alternatively to uploading files, you can also submit a publicly accessible URL for processing. Supported protocols are:
* HTTP(s) URLs with response Content-Type image/* or video/*   
* RTSP (live-streaming)
* RTMP (live-streaming)
```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'

const example_image_url = 'https://farm2.staticflickr.com/1080/1301049949_532835a8b5_z.jpg';

(async() => {
    const endpoint = await EyePopSdk.endpoint().connect()
    try {
        let results = await endpoint.process({url: example_image_url})
        for await (let result of results) {
            console.log(result)
        }        
    } finally {
        await endpoint.disconnect()
    }
})
```
### Processing Videos 
You can process videos via upload or public URLs. This example shows how to process all video frames of a file 
retrieved from a public URL.

```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'

const example_video_url = 'https://demo-eyepop-videos.s3.amazonaws.com/test1_vlog.mp4';

(async() => {
    const endpoint = await EyePopSdk.endpoint().connect()
    try {
        let results = await endpoint.process({url: example_image_url})
        for await (let result of results) {
            console.log(result)
        }        
    } finally {
        await endpoint.disconnect()
    }
})
```
### Canceling Jobs
Any job that has been queued or is in-progress can be cancelled. E.g. stop the video processing after
predictions have been processed for 10 seconds duration of the video.
```typescript
import { EyePopSdk } from '@eyepop.ai/eyepop'

const example_video_url = 'https://demo-eyepop-videos.s3.amazonaws.com/test1_vlog.mp4';

(async() => {
    const endpoint = EyePopSdk.endpoint().connect()
    try {
        let results = await endpoint.process({url: example_image_url})
        for await (let result of results) {
            console.log(result)
            if (result['seconds'] >= 10.0) {
                results.cancel()
            }
        }        
    } finally {
        await endpoint.disconnect()
    }
})
```
## Other Usage Options
#### Auto start workers
By default, `EyePopSdk.endpoint().connect()` will start a worker if none is running yet. To disable this behavior 
create an endpoint with `EyePopSdk.endpoint({autoStart: false})`.
#### Stop pending jobs
By default, `EyePopSdk.endpoint().connect()` will cancel all currently running or queued jobs on the worker. 
It is assumed that the caller _takes full control_ of that worker. To disable this behavior create an endpoint with 
`EyePopSdk.endpoint({stopJobs: false})`.



