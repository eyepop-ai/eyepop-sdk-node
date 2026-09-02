---
description: Draw predictions on an HTML canvas
icon: chart-area
---

# Visualization

`@eyepop.ai/eyepop-render-2d` draws predictions onto a canvas — boxes, keypoints, contours, and more.

```shell
npm install --save @eyepop.ai/eyepop-render-2d
```

```typescript
import { EyePop } from '@eyepop.ai/eyepop'
import { Render2d } from '@eyepop.ai/eyepop-render-2d'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            { type: 'inference', ability: 'eyepop.person:latest' },
        ],
    },
}).connect()

const context = document.getElementById('my-canvas').getContext('2d')
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

* [Processing Media](inference.md) — produce the predictions to draw
* [Composable Pops](composable-pops.md) — chain models into a pipeline
