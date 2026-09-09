---
description: Build a Pop with the Node types
icon: diagram-project
---

# Composable Pops

A Pop chains abilities into a pipeline: detect, crop to each detection, and run another ability on the crop. Pass it when you create the endpoint.

This page is the Node construction API. Every component type, its attributes, and how components chain are covered once in the [Component Reference](../../platform/pop-reference.md), with worked pipelines in [Examples](../../platform/pop-examples.md).

### The types

All exported from `@eyepop.ai/eyepop`.

| Type | Purpose |
| --- | --- |
| `Pop` | The pipeline itself: `components`, and optionally `postTransform` and `defaults`. |
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
Three things in the [Component Reference](../../platform/pop-reference.md) are not yet available from Node: the `objectAreaThreshold` and `multiClass` attributes, and the `raw` inference type. `PopComponent` is also a plain union rather than a discriminated one, so TypeScript will not flag an attribute used on the wrong component type — the worker rejects it instead.
{% endhint %}

### Next steps

* [Component Reference](../../platform/pop-reference.md) — every component type and attribute
* [Examples](../../platform/pop-examples.md) — worked pipelines end to end
* [Running Inference](inference.md) — submit media to the Pop you just built
* [Visualization](visualization.md) — draw the results on a canvas
