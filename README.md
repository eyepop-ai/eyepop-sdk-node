# EyePop.ai Node SDK

The EyePop.ai Node SDK lets Node.js applications process images and videos with EyePop.

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

The endpoint runs in pipeline mode, the default: it opens a socket to the pipeline API and sets the `pop` there, and creates no worker session. The compute API names the pipeline API (see [Pipeline Mode](#pipeline-mode)). A worker session, with `isPipelineMode: false`, is deprecated; passing `pop` up front then creates a transient session with the requested pipeline already scheduled, using compute-api with `wait=true`. Persistent deployments are created separately.

## Configure a Pop

A Pop can be configured when the worker endpoint is created, so the pipeline is ready before media is processed:

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

Use `endpoint.changePop(pop)` when an already connected endpoint needs to switch Pops. Persistent sessions are usually preconfigured; process media directly unless your deployment is intended to accept runtime Pop changes.

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

> **Deprecated.** The worker session flow, persistent and transient sessions alike, is deprecated. Use [pipeline mode](#pipeline-mode), the default.

For a provisioned persistent worker session, set the session UUID and connect without a transient pop:

```shell
export EYEPOP_PIPELINE_MODE=false
export EYEPOP_SESSION_UUID=<your_session_uuid>
```

```javascript
const endpoint = await EyePop.workerEndpoint().connect()
```

Persistent sessions are worker sessions, so turn pipeline mode off with `EYEPOP_PIPELINE_MODE=false` (or `isPipelineMode: false`). Then, when `EYEPOP_SESSION_UUID` is set, `EyePop.workerEndpoint()` connects to that persistent session. Persistent deployments are normally created outside the SDK through the compute API or EyePop tooling.

On a persistent session the endpoint works on a pipeline the session's agent does not own (one whose id does not start with `agent-`), when there is one. `changePop()` on a pipeline the session's declaration owns, a declared stream's or a processor's, rejects with `PipelineManagedError`, which names the pipeline, the session and the worker's `error`, `reason` and `serverMessage`; change the declaration instead. It does not retry.

## Pipeline Mode

Pipeline mode is the default: a worker endpoint runs its jobs on the pipeline API instead of a worker session. Set `isPipelineMode: false`, or `EYEPOP_PIPELINE_MODE=false`, for a worker session. `EYEPOP_ENV=production|local` picks the pipeline API (`pipeline.eyepop.ai`, `127.0.0.1:9002`); unset, the compute API names it. The code that uses the endpoint stays the same:

```javascript
const endpoint = await EyePop.workerEndpoint({ pop }).connect()
for await (const prediction of await endpoint.process({ source: { path: 'photo.jpg' } })) {
    console.log(prediction)
}
await endpoint.disconnect()
```

The endpoint opens a socket to the pipeline API at `connect()` and sets its pop there. `EYEPOP_ENV` (or `pipelineApiUrl`) names the pipeline API; unset, the compute API at `eyepopUrl` names it in its `/v1/configs` (`pipeline_api_url`); with `isLocalMode`, `eyepopUrl` is the pipeline API itself (default `http://127.0.0.1:9002`). Jobs go out in the order they are submitted, each queued behind the ones before it on its socket; `jobQueueLength` may not exceed 256.

Each socket runs its own pipeline, which plays its sources one after another. While every open socket has a source, the next job opens another, up to 4 (`pipelineSockets`), each with the pop set; a job goes on the socket with the fewest open sources. A batch submitted at once therefore runs on 4 pipelines, and jobs run one after another stay on one socket. On a T4, 4 sockets of 704-pixel images ran `common-objects.large` at about 89 images per second, against 30 on one. When the pipeline API refuses another socket, the job goes on an open one, and the endpoint asks again only 10 s later (that refusal is not waited for, as below). A live source never ends, so nothing queued behind it would play: it goes on an idle socket or a new one, which the 4 do not count, and no other job is sent on a socket that has one. `changePop` sets the pop on every open socket.

**Waiting for capacity.** A pipeline API with no capacity refuses a new socket with HTTP 503 (or 429), and a new GPU node takes minutes to arrive, so the SDK waits and asks again instead of failing. It waits the `Retry-After` seconds the answer names (at least 1), growing by half with each refusal up to 10 s or the `Retry-After` itself if that is more, plus up to half again as jitter, so sockets do not retry in step. Without `Retry-After` it waits 1, 2, 4, 8 and then 10 s, each with jitter between half and full. The wait is limited by `pipelineWaitTimeout` seconds (default 600, or `EYEPOP_PIPELINE_WAIT_TIMEOUT`; `0` does not wait and raises at the first refusal). The limit counts from the first refusal and is shared: a job queued behind a socket that is still refused, or that gave up, does not start a wait of its own but makes one attempt and fails with it. A give-up is remembered while jobs keep failing against it, and forgotten after 30 s without one, or when a socket opens, `connect()` or `disconnect()`: a queue of jobs fails at once however long it is, and a job submitted later gets a wait of its own. A job that fails against a give-up reports `waitedSecs` 0. After the limit it rejects with `PipelineOverloadedError`. The first wait is logged at `warn`, with the status, the `Retry-After` and the time left, and every retry at `debug`; a script or a test suite that should not hang for ten minutes sets `pipelineWaitTimeout` low or to `0`. `disconnect()` ends every wait at once, and cancelling a job that waits for a socket ends its wait; neither leaves a timer behind. This holds for `connect()` and for any job, `changePop` or reconnect that opens a socket, except the extra sockets of a batch, which the endpoint does not wait for (see above). A 401 exchanges the API key once, as before; any other refusal, such as a 404, rejects at once. Jobs go out in the order they are submitted, so while a live source waits for its own socket, the jobs queued behind it wait too, up to `pipelineWaitTimeout`, even those that an open socket could take.

| | Pipeline mode |
|---|---|
| `path`, `file`, `stream` sources, `uploadGroup`, `uploadStreamGroup` | Uploads of known size up to 8 MiB go in one message, others in chunks as the pipeline reads them. |
| `url`, `assetUuid` sources, `loadFromGroup` | Supported. An `rtsp://` or `rtmp://` url is live. |
| `mediaStream` source | A WHIP ingress, signalled on the socket; the media goes over WebRTC. |
| `componentParams`, `roi`, `camera`, `fps` | Supported. |
| `motionDetect` | Its members (`motionDetect`, `motionSensitivity`, `motionThreshold`, `motionGap`, `motionGridX`, `motionGridY`) go on the source; a member left unset takes the pop's `defaults`. A group takes no motion detection: `uploadGroup`, `uploadStreamGroup` and `loadFromGroup` with `motionDetect` reject with `PipelineCommandError` `invalid_request` before anything is sent. Needs a pipeline API of eyepop-worker v4.15.0 or later; an older one refuses the source `invalid_request`. |
| `videoMode` | Goes on an upload's source: `buffer` reads the whole upload before it plays, so an MP4 with its `moov` atom at the end plays; `stream` plays it as it arrives. Unset, the pipeline API buffers a video upload. Needs eyepop-worker v4.15.0 or later. |
| `rtspForceNonCompliantUrl` | Not sent; a warning names it once per endpoint. |
| `changePop`, `pop()` | Supported. A pop the pipeline refuses rejects, and the last pop it took stays. |
| `session()` | Its `baseUrl` is the pipeline API's url, there is no `pipelineId`, and `isPipelineMode` is `true`: an endpoint created from it with `session` runs in pipeline mode too, with the token's own `validUntil`. |
| `apiKey`, `accessToken`, `session`, `oAuth2` | An API key, or a login token (`accessToken`, `oAuth2`, with `accountId` naming the account), is exchanged at the compute API and never sent to the pipeline API; an `accessToken` that already carries an account claim, or that the compute API refuses as "API key or user login required", is sent as is. A 401 exchanges again once. Node sends the token as `Authorization: Bearer`; a browser, which cannot set headers on a WebSocket, as the `eyepop.bearer.<jwt>` subprotocol. |
| `popId`, `sessionUuid`, `sessionName`, `pipelineImage`, `pipelineVersion` | Throw at construction. Set `isPipelineMode: false` to use them. |
| Prediction version | The pipeline API's own (V3); none is sent. |

**Errors.** A source that ends with an error rejects with `PipelineSourceError`. A command the pipeline API refuses rejects with `PipelineCommandError`, except `queue_full` on a source: the socket is full (256 open sources, or 32 MiB of uploads sent in one message), so the source goes again once another of the endpoint's sources on that socket ended. It rejects only when none of them is open. When the socket closes under a job, the job rejects with `PipelineSocketClosedError`, which carries the close's code and reason, and is not sent again; jobs not yet sent go out on a new socket. After the pipeline stops itself when idle, the next job opens a new socket and sets the pop again; after `credential_expired`, `overloaded` or `shutting_down`, a new socket is opened at once, with one attempt that does not wait for capacity (a refusal is logged, and the next job or `changePop` opens a socket and waits as above). A live source refused `overloaded` is sent once more on the new socket, and when that one is refused too, rejects with `PipelineOverloadedError` (a `PipelineCommandError` with `error === 'overloaded'`, as is the one a socket that stayed refused rejects with, above; `waitedSecs` says how long it waited, and `cause` is the last refusal, an exported `UpgradeError` with its `status`). `PipelineOverloadedError` extends `PipelineCommandError`, so a handler that treats a `PipelineCommandError` as one source's refusal also catches a socket that stayed at capacity; test `instanceof PipelineOverloadedError` first. Cancelling a job stops its source on the pipeline with `stopSource`, queued or playing, so a cancelled live source frees its place; a pipeline API from before `stopSource` lets the source run until it ends or the endpoint disconnects. A chunked upload whose source ends early, or whose job is cancelled, still sends its `uploaded`, so the next upload on the socket does not wait behind it.

## Accounts

Work runs and is billed under one account. If your credential belongs to more than one account, name it with `EYEPOP_ACCOUNT_UUID` or the `accountId` option, which `EyePop.workerEndpoint()` and `EyePop.dataEndpoint()` both take. In pipeline mode `accountId` is sent with the exchange of a login token (`accessToken` or `oAuth2`), and with the `/v1/configs` request when the compute API names the pipeline API (no `EYEPOP_ENV` or `pipelineApiUrl`). An API key is exchanged without it, so with an API key and `EYEPOP_ENV` (or `pipelineApiUrl`) set, `accountId` has no effect in pipeline mode. With `isPipelineMode: false` it sends it as `account_uuid` when it creates a worker session and reuses only a live session of that account; without it, the compute API refuses a session it cannot attribute to an account.

## Documentation

Customer documentation lives in [docs/gitbook](docs/gitbook/README.md) and is published at [docs.eyepop.ai](https://docs.eyepop.ai).

## Module Docs

- [@eyepop.ai/eyepop](src/eyepop/README.md) - Node and browser SDK.
- [@eyepop.ai/eyepop-render-2d](src/eyepop-render-2d/README.md) - Canvas rendering helpers for predictions.
- [@eyepop.ai/react-native-eyepop](src/react-native-eyepop/README.md) - React Native SDK package.
