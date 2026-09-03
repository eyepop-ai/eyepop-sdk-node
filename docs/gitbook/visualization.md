---
description: Draw predictions on an HTML canvas
icon: chart-area
---

# Visualization

`@eyepop.ai/eyepop-render-2d` draws predictions onto a canvas — boxes, keypoints, contours, and more.

```shell
npm install --save @eyepop.ai/eyepop @eyepop.ai/eyepop-render-2d canvas
```

This example runs under Node. A browser works at runtime — take the context from a DOM canvas and pass `source: { file }`, since resolving a `path` is not supported there — but `Render2d.renderer` is typed against the node-`canvas` context, so TypeScript needs a cast.

```typescript
import { createCanvas, loadImage } from 'canvas'
import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            { type: PopComponentType.INFERENCE, ability: 'eyepop.person:latest' },
        ],
    },
}).connect()

const image = await loadImage('people.jpg')
const canvas = createCanvas(image.width, image.height)
const context = canvas.getContext('2d')
context.drawImage(image, 0, 0)

const renderer = Render2d.renderer(context, [
    Render2d.renderBox({ showClass: true, showConfidence: true }),
])

const results = await endpoint.process({ source: { path: 'people.jpg' } })
for await (const result of results) {
    renderer.draw(result)
}
```

Renderers compose: pass several to `Render2d.renderer()` to draw boxes, poses, and contours over the same prediction.

{% hint style="info" %}
The full renderer list and options live with the package at [`src/eyepop-render-2d`](https://github.com/eyepop-ai/eyepop-sdk-node/blob/main/src/eyepop-render-2d/README.md).
{% endhint %}

### Next steps

* [Running Inference](inference.md) — produce the predictions to draw
* [Composable Pops](composable-pops.md) — chain models into a pipeline
