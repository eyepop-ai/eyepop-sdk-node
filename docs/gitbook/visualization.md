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
import { writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from 'canvas'
import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

const image = await loadImage('people.jpg')
const canvas = createCanvas(image.width, image.height)
const context = canvas.getContext('2d')
context.drawImage(image, 0, 0)

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            { type: PopComponentType.INFERENCE, ability: 'eyepop.person:latest' },
        ],
    },
}).connect()

try {
    const renderer = Render2d.renderer(context, [
        Render2d.renderBox({ showClass: true, showConfidence: true }),
    ])

    const results = await endpoint.process({ source: { path: 'people.jpg' } })
    for await (const result of results) {
        renderer.draw(result)
    }
} finally {
    await endpoint.disconnect()
}

await writeFile('people-annotated.png', canvas.toBuffer('image/png'))
```

Renderers compose: pass several to `Render2d.renderer()` to draw boxes, poses, and contours over the same prediction.

### Depth maps

`Render2d.renderDepth()` paints a frame's [depth map](../../platform/depth-and-world-coordinates/depth-maps.md) over it as a turbo heatmap — near is warm, far is cool, and sky pixels are left untouched unless `renderSky` is set.

```typescript
const renderer = Render2d.renderer(context, [
    Render2d.renderDepth({ opacity: 0.5, renderSky: false }),
])
```

The Node SDK draws depth in 2D only; for world coordinates as a 3D scene, `examples/webpack/src/world-demo.html` in this repository does it with three.js.

{% hint style="info" %}
The full renderer list and options live with the package at [`src/eyepop-render-2d`](https://github.com/eyepop-ai/eyepop-sdk-node/blob/main/src/eyepop-render-2d/README.md).
{% endhint %}

### Next steps

* [Running Inference](inference.md) — produce the predictions to draw
* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [Depth and World Coordinates](../../platform/depth-and-world-coordinates/README.md) — depth maps, calibration, and metres
