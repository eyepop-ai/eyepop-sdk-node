# EyePop.ai Node SDK

The EyePop.ai Node SDK lets Node.js applications process images and videos with EyePop worker sessions.

## Install

```shell
npm install @eyepop.ai/eyepop
```

Requires Node.js 18 or newer. CI validates Node.js 22.

## Configure

Set your EyePop API key in the server environment:

```shell
export EYEPOP_API_KEY=<your_api_key>
```

API keys are secrets. Do not put `EYEPOP_API_KEY` in browser bundles, mobile app bundles, or public repositories.

## Quickstart

Create `quickstart.mjs`:

```javascript
import { EyePop } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            {
                type: 'inference',
                ability: 'eyepop.person:latest',
                categoryName: 'person',
            },
        ],
    },
}).connect()

try {
    const results = await endpoint.process({
        source: { path: 'examples/example.jpg' },
    })

    for await (const result of results) {
        console.log(result)
    }
} finally {
    await endpoint.disconnect()
}
```

Run it:

```shell
node quickstart.mjs
```

Passing `pop` up front creates a transient worker session with the requested pipeline already scheduled. SDK-created sessions use compute-api with `wait=true`; persistent deployments are created separately.

## Configure a Pop

Transient sessions can be configured when the worker endpoint is created, so EyePop can schedule the right compute before media is processed:

```javascript
const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            {
                type: 'inference',
                ability: 'eyepop.person:latest',
                categoryName: 'person',
            },
        ],
    },
}).connect()
```

Use `endpoint.changePop(pop)` when an already connected transient worker needs to switch Pops. Persistent sessions are usually preconfigured; process media directly unless your deployment is intended to accept runtime Pop changes.

## World Coordinates

Predictions can carry a 3D position in **meters** alongside their 2D one, back-projected through a depth map. Two things have to be true: the Pop must name a depth ability, and the components whose predictions should be translated must opt in.

```javascript
const pop = {
    components: [{ type: 'inference', ability: 'eyepop.person:latest', toWorld: true }],
    depthMap: { ability: 'eyepop.depth.metric.small:latest' },
    defaults: { camera: { hfovDegrees: 72 } },
}
```

Use a **metric** depth ability. A `relative` one is accepted and silently produces no world coordinates at all: relative depth is scale- _and_ shift-invariant, so a cloud recovered from it would be distorted rather than merely unscaled.

The four metric depth abilities are `eyepop.depth.metric.small`, `eyepop.depth.metric.small-landscape`, `eyepop.depth.metric.large` and `eyepop.depth.metric.large-landscape`. A map keeps the source's aspect ratio; the ability sets the box it fits inside - 280x280 and 518x518 for the plain variants, 504x280 and 924x518 for the `-landscape` ones. Landscape media is therefore much denser from a `-landscape` variant (1280x720 gives 518x291 against 921x518), while portrait and square media get the same grid either way. Smaller maps mean faster responses and higher throughput.

`toWorld` only means something on a component that runs its own inference - inference and tracking. A contour finder's points do get enriched, but they belong to the object that fed it, so the request goes on the inference component upstream.

`worldX`, `worldY` and `worldZ` appear on key points, outline points and contour points (including cutouts), in **prediction v2 only**. A point the worker could not place - sky, outside the depth map, no usable map - carries none of the three, so test for `undefined` rather than for a sentinel value. Bounding boxes are not enriched: a box is not a point, and any single anchor choice would be arbitrary.

An object with a segmentation mask also carries a dense point cloud, one xyz triple per mask pixel:

```javascript
import { cloudOfObject } from '@eyepop.ai/eyepop'

const cloud = cloudOfObject(obj)
if (cloud) {
    console.log(cloud.at(0, 0)) // by mask pixel, or undefined
    console.log(cloud.atSource(x, y)) // by source coordinate inside the object's box
    console.log(cloud.placedPoints) // just the points that were placed
    console.log(cloud.bounds) // per-axis min/max in meters, or undefined
}
```

### The whole scene

`depthMap.toWorld` back-projects the depth map itself, so the results carry a point cloud of the entire scene rather than one per segmented object. It is also what reveals the map: without it the depth branch the Pop builds stays out of the response. It stands on its own - a Pop with nothing but a `depthMap` asking for `toWorld` is complete, no component needs to opt in.

```javascript
const pop = {
    components: [{ type: 'inference', ability: 'eyepop.person:latest' }],
    depthMap: { ability: 'eyepop.depth.metric.small:latest', toWorld: true },
}
```

Read it with `cloudOfDepth(prediction.depth, prediction.source_width, prediction.source_height)`. It arrives as `depth.world`, indexed exactly like `depth.values`: same grid, same order, so the point for a pixel and the depth it came from share an index. Both are sent, because a NaN point says only that the pixel could not be placed while the value at that index says why - `+Infinity` for sky, or a reading that is not a distance at all.

`cloudsOfPrediction(prediction)` returns every cloud in one prediction, with the scene cloud last.

### Camera calibration

A calibration is what turns a depth map into measurable world coordinates. Supply it per source, or in the Pop's `defaults` for every source it processes:

```javascript
await endpoint.process({
    source: { url: 'https://example.com/street.jpg' },
    camera: {
        intrinsics: { fx: 0.9, fy: 1.6, cx: 0.5, cy: 0.5 },
        extrinsics: { rotation: { w: 0.5736, x: -0.8192, y: 0, z: 0 }, translation: { x: 0, y: 0, z: 3 } },
    },
})
```

Intrinsics are **normalised to the frame**, not in pixels, so one calibration survives a resolution change. Exactly one of `intrinsics` and `hfovDegrees` describes the lens - both is rejected rather than resolved by precedence, since two descriptions that disagree have no right answer.

Extrinsics are the camera-to-world pose, so world coordinates come back in a **Z up** frame with the ground at Z = 0. Note this is the _inverse_ of what `cv2.solvePnP` returns, and its `tvec` is not the camera position. Without extrinsics the coordinates are in the OpenCV camera frame: X right, Y down, Z forward.

Without any calibration the worker assumes a 60-degree horizontal field of view. That is a development scaffold: for canonical metric depth the guess cancels out of X and Y and survives only in Z, so lateral measurements stay exact while every distance along the optical axis is wrong by however wrong the guess was.

## Persistent Sessions

For a provisioned persistent worker session, set the session UUID and connect without a transient pop:

```shell
export EYEPOP_SESSION_UUID=<your_session_uuid>
```

```javascript
const endpoint = await EyePop.workerEndpoint().connect()
```

When `EYEPOP_SESSION_UUID` is set, `EyePop.workerEndpoint()` connects to that persistent session. Persistent deployments are normally created outside the SDK through the compute API or EyePop tooling.

## Pipeline Mode

With `isPipelineMode: true`, or `EYEPOP_PIPELINE_MODE=true`, a worker endpoint runs its jobs on the pipeline API instead of a worker session. The code that uses the endpoint stays the same:

```javascript
const endpoint = await EyePop.workerEndpoint({ isPipelineMode: true, pop }).connect()
for await (const prediction of await endpoint.process({ source: { path: 'photo.jpg' } })) {
    console.log(prediction)
}
await endpoint.disconnect()
```

The endpoint opens one socket to the pipeline API at `connect()` and sets its pop there. The compute API at `eyepopUrl` names the pipeline API in its `/v1/configs` (`pipeline_api_url`); with `isLocalMode`, `eyepopUrl` is the pipeline API itself (default `http://127.0.0.1:9002`). Jobs go out in the order they are submitted, each queued behind the ones before it; `jobQueueLength` may not exceed 256.

| | Pipeline mode |
|---|---|
| `path`, `file`, `stream` sources, `uploadGroup`, `uploadStreamGroup` | Uploads of known size up to 8 MiB go in one message, others in chunks as the pipeline reads them. |
| `url`, `assetUuid` sources, `loadFromGroup` | Supported. An `rtsp://` or `rtmp://` url is live. |
| `mediaStream` source | A WHIP ingress, signalled on the socket; the media goes over WebRTC. |
| `componentParams`, `roi`, `camera`, `fps` | Supported. |
| `videoMode`, `motionDetect` | Not sent yet; a warning names each once per endpoint (AWSU-317). |
| `rtspForceNonCompliantUrl` | Not sent; a warning names it once per endpoint. |
| `changePop`, `pop()` | Supported. A pop the pipeline refuses rejects, and the last pop it took stays. |
| `session()` | Its `baseUrl` is the pipeline API's url, there is no `pipelineId`, and `isPipelineMode` is `true`: an endpoint created from it with `session` runs in pipeline mode too, with the token's own `validUntil`. |
| `apiKey`, `accessToken`, `session`, `oAuth2` | An API key is exchanged at the compute API and never sent to the pipeline API. Node sends the token as `Authorization: Bearer`; a browser, which cannot set headers on a WebSocket, as the `eyepop.bearer.<jwt>` subprotocol. |
| `popId`, `sessionUuid`, `sessionName`, `pipelineImage`, `pipelineVersion` | Throw at construction. |
| Prediction version | The pipeline API's own (V3); none is sent. |

**Errors.** A source that ends with an error rejects with `PipelineSourceError`. A command the pipeline API refuses, `queue_full` among them, rejects with `PipelineCommandError`. When the socket closes under a job, the job rejects with `PipelineSocketClosedError`, which carries the close's code and reason, and is not sent again; jobs not yet sent go out on a new socket. After the pipeline stops itself when idle, the next job opens a new socket and sets the pop again; after `credential_expired`, `overloaded` or `shutting_down`, a new socket is opened at once. A live source refused `overloaded` is sent once more on the new socket. Cancelling a job stops its source on the pipeline with `stopSource`, queued or playing, so a cancelled live source frees its place; a pipeline API from before `stopSource` lets the source run until it ends or the endpoint disconnects.

## Accounts

A worker session runs and is billed under one account. If your credential belongs to more than one account, name it with `EYEPOP_ACCOUNT_UUID` or the `accountId` option, which `EyePop.workerEndpoint()` and `EyePop.dataEndpoint()` both take. A worker endpoint sends it as `account_uuid` when it creates a session and reuses only a live session of that account; without it, the compute API refuses a session it cannot attribute to an account.

## Documentation

Customer documentation lives in [docs/gitbook](docs/gitbook/README.md) and is published at [docs.eyepop.ai](https://docs.eyepop.ai).

## Module Docs

- [@eyepop.ai/eyepop](src/eyepop/README.md) - Node and browser SDK for worker sessions.
- [@eyepop.ai/eyepop-render-2d](src/eyepop-render-2d/README.md) - Canvas rendering helpers for predictions.
- [@eyepop.ai/react-native-eyepop](src/react-native-eyepop/README.md) - React Native SDK package.
