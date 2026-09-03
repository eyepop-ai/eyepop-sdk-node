---
description: Chain models into a multi-stage inference pipeline
icon: diagram-project
---

# Composable Pops

A Pop chains models into a pipeline: detect, crop to each detection, and run another model on the crop. Pass it when you create the endpoint.

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
                    operator: { type: ForwardOperatorType.CROP },
                    targets: [
                        {
                            type: PopComponentType.INFERENCE,
                            ability: 'eyepop.vehicle.license-plate:latest',
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

### Open-vocabulary detection

A VLM ability takes prompts through `params`.

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

Pass the Pop at construction whenever you can. `endpoint.changePop(pop)` exists for the case where an already connected transient worker has to switch.

{% hint style="info" %}
The complete component reference — every component type, its attributes, and worked examples — lives with the package at [`src/eyepop/composable-pops.md`](https://github.com/eyepop-ai/eyepop-sdk-node/blob/main/src/eyepop/composable-pops.md).
{% endhint %}

### Next steps

* [Running Inference](inference.md) — submit media to the Pop you just built
* [Visualization](visualization.md) — draw the results on a canvas
