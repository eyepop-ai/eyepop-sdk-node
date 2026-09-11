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
| `ForwardOperatorType` | `CROP`, `FULL`, `CROP_WITH_FULL_FALLBACK`. |
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
