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

Predictions can carry a 3D position in **metres** alongside their 2D one, back-projected through a depth map. Two things have to be true: the Pop must name a depth ability, and the components whose predictions should be translated must opt in.

```javascript
const pop = {
    components: [{ type: 'inference', ability: 'eyepop.person:latest', toWorld: true }],
    depthMap: { ability: 'eyepop.depth.anything-3:latest' },
    defaults: { camera: { hfovDegrees: 72 } },
}
```

Use a **metric** depth ability. A `relative` one is accepted and silently produces no world coordinates at all: relative depth is scale- _and_ shift-invariant, so a cloud recovered from it would be distorted rather than merely unscaled.

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
    console.log(cloud.bounds) // per-axis min/max in metres, or undefined
}
```

### The whole scene

`depthMap.toWorld` back-projects the depth map itself, so the results carry a point cloud of the entire scene rather than one per segmented object. It is also what reveals the map: without it the depth branch the Pop builds stays out of the response. It stands on its own - a Pop with nothing but a `depthMap` asking for `toWorld` is complete, no component needs to opt in.

```javascript
const pop = {
    components: [{ type: 'inference', ability: 'eyepop.person:latest' }],
    depthMap: { ability: 'eyepop.depth.anything-3:latest', toWorld: true },
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

Without any calibration the worker assumes a 60 degree horizontal field of view. That is a development scaffold: for canonical metric depth the guess cancels out of X and Y and survives only in Z, so lateral measurements stay exact while every distance along the optical axis is wrong by however wrong the guess was.

## Persistent Sessions

For a provisioned persistent worker session, set the session UUID and connect without a transient pop:

```shell
export EYEPOP_SESSION_UUID=<your_session_uuid>
```

```javascript
const endpoint = await EyePop.workerEndpoint().connect()
```

When `EYEPOP_SESSION_UUID` is set, `EyePop.workerEndpoint()` connects to that persistent session. Persistent deployments are normally created outside the SDK through the compute API or EyePop tooling.

## Documentation

Customer documentation lives in [docs/gitbook](docs/gitbook/README.md) and is published at [docs.eyepop.ai](https://docs.eyepop.ai).

## Module Docs

- [@eyepop.ai/eyepop](src/eyepop/README.md) - Node and browser SDK for worker sessions.
- [@eyepop.ai/eyepop-render-2d](src/eyepop-render-2d/README.md) - Canvas rendering helpers for predictions.
- [@eyepop.ai/react-native-eyepop](src/react-native-eyepop/README.md) - React Native SDK package.
