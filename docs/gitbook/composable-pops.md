---
description: Build a Pop with the Node types
icon: diagram-project
---

# Composable Pops

A Pop chains abilities into a pipeline: detect, crop to each detection, and run another ability on the crop. Pass it when you create the endpoint.

This page is the Node construction API. Every component type and its attributes are covered once in [Components](../../platform/pop-components.md), how they chain in [Forwarding](../../platform/pop-forwarding.md), and worked pipelines in [Examples](../../platform/pop-examples.md).

### The types

All exported from `@eyepop.ai/eyepop`.

| Type | Purpose |
| --- | --- |
| `Pop` | The pipeline itself: `components`, and optionally `postTransform`, `defaults` and `depthMap`. |
| `PopComponentType` | Component discriminator: `INFERENCE`, `TRACKING`, `CONTOUR_FINDER`, `COMPONENT_FINDER`, `FORWARD`. |
| `ForwardOperatorType` | `CROP`, `FULL`, `CROP_WITH_FULL_FALLBACK`, `SELECT_CROP`, `SELECT_FULL`. |
| `PopSelect`, `SelectMode` | The `select` block of a `SELECT_CROP` or `SELECT_FULL` operator. |
| `InferenceType`, `MotionModel`, `ContourType` | Enums for the corresponding fields. |

Components are plain object literals tagged with `type`, so a Pop is ordinary JSON you can build, store, and pass around.

### Building a Pop

```typescript
import { EyePop, ForwardOperatorType, PopComponentType } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            {
                type: PopComponentType.INFERENCE,
                ability: 'eyepop.vehicle:latest',
                categoryName: 'vehicles',
                confidenceThreshold: 0.8,
                forward: {
                    operator: {
                        type: ForwardOperatorType.CROP,
                        includeClasses: ['car', 'truck'],
                    },
                    targets: [
                        {
                            type: PopComponentType.INFERENCE,
                            ability: 'eyepop.vehicle.license-plate:latest',
                            topK: 1,
                            forward: {
                                operator: { type: ForwardOperatorType.CROP },
                                targets: [
                                    {
                                        type: PopComponentType.INFERENCE,
                                        ability: 'eyepop.text.recognize.landscape:latest',
                                        categoryName: 'license-plate',
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        ],
    },
}).connect()
```

### Selecting one frame per track

A `SELECT_CROP` or `SELECT_FULL` operator goes on a `TRACKING` component's forward. Instead of running its targets on every frame, it picks each track's most relevant detection and runs the targets once on the past frame where that detection was seen: on a crop of it (`SELECT_CROP`, shaped by `crop.boxPadding` and `crop.orientationTargetAngle`) or on that whole frame (`SELECT_FULL`, which takes no `crop`).

```typescript
{
    type: PopComponentType.TRACKING,
    reidModel: 'eyepop.person.reid:latest',
    forward: {
        operator: {
            type: ForwardOperatorType.SELECT_CROP,
            select: {
                mode: SelectMode.MOST_RELEVANT,
                relevancyModel: 'eyepop.person.face.short-range:latest',
                minTrackLengthSeconds: 1,
                intervalSeconds: 10,
            },
            crop: { boxPadding: 1.1 },
        },
        targets: [{ type: PopComponentType.INFERENCE, ability: 'eyepop.person.face.short-range:latest' }],
    },
}
```

- Without a relevancy model, the most relevant detection is the most confident and largest one that is not cut off by the frame edge. `relevancyModel` (or `relevancyModelUuid`) names an ability that runs on every tracked object of every frame; a detection it finds nothing on is never selected, and its confidence weighs the rest.
- A track shorter than `minTrackLengthSeconds` is never selected. With `intervalSeconds`, the first selection comes that long after the track starts, then at most one per interval and only when a more relevant detection turned up. The track's end reports a final one if it improved since. Without `intervalSeconds`, each track is selected once, when it ends.

The targets' results arrive late, as **selected predictions**: an ordinary `Prediction` with `selected: true`. Its `timestamp` is the past frame's, so it comes after predictions with later timestamps; its one object is the selected detection with the targets' results nested under it, and its `trackId` links it to that track's live predictions. A selected prediction is not the stream's progress, so skip it where you draw or count frames. `Renderer2d` does that already.

```typescript
for await (const prediction of results) {
    if (prediction.selected) {
        handleSelection(prediction)
    } else {
        handleFrame(prediction)
    }
}
```

`examples/webpack/src/track-demo.html` in this repository shows both kinds side by side: live predictions build a list of the tracks, and selected predictions fill in each track's result as they arrive.

The endpoint asks the worker for prediction version 3 whenever its Pop has a select forward, which is the version that carries selected predictions. For any other Pop it keeps asking for version 2.

### World coordinates

`depthMap` names the depth ability, and `toWorld` on a component asks for its point-based predictions in meters. `defaults.camera` carries a calibration for every source the Pop processes.

```typescript
const pop = {
    components: [{
        type: PopComponentType.INFERENCE,
        ability: 'eyepop.person:latest',
        toWorld: true,
    }],
    depthMap: { ability: 'eyepop.depth.metric.small:latest' },
    defaults: { camera: { hfovDegrees: 72 } },
}
```

Both the depth map's "exactly one of `ability` / `abilityUuid`" and the camera's "exactly one lens" are checked before the request leaves, so a Pop that cannot mean what it says throws here rather than returning a `400`. Decode the results with `decodeDepthMap()`, `cloudOfObject()`, `cloudOfDepth()` and `cloudsOfPrediction()`.

See [Depth and World Coordinates](../../platform/depth-and-world-coordinates/README.md) for the whole feature.

### Prompting an ability

Abilities backed by a vision-language model take their instruction through `params`.

```typescript
import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            {
                type: PopComponentType.INFERENCE,
                ability: 'eyepop.localize-objects:latest',
                categoryName: 'objects',
                params: { prompts: [{ prompt: 'person' }] },
            },
        ],
    },
}).connect()
```

### Changing a Pop

Pass the Pop at construction whenever you can. `endpoint.changePop(pop)` switches the Pop on an already connected endpoint: it recreates the pipeline on a transient worker, and patches the pipeline's Pop on a persistent Deployment meant to accept runtime changes.

{% hint style="info" %}
Three things in [Components](../../platform/pop-components.md) are not yet available from Node: the `objectAreaThreshold` and `multiClass` attributes, and the `raw` inference type. `PopComponent` is also a plain union rather than a discriminated one, so TypeScript will not flag an attribute used on the wrong component type. The worker does not reject it either — it ignores what the component type does not define, so a misplaced attribute silently does nothing.
{% endhint %}

### Next steps

* [Components](../../platform/pop-components.md) — every component type and attribute
* [Forwarding](../../platform/pop-forwarding.md) — how components chain
* [Examples](../../platform/pop-examples.md) — worked pipelines end to end
* [Running Inference](inference.md) — submit media to the Pop you just built
* [Visualization](visualization.md) — draw the results on a canvas
* [Depth and World Coordinates](../../platform/depth-and-world-coordinates/README.md) — predictions positioned in meters
