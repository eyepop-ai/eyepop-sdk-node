---
description: Call EyePop from Node, the browser, and React Native
icon: node-js
---

# Node SDK

The EyePop Node SDK calls the inference and data APIs from TypeScript or JavaScript. Install it, set an API key, and run a Pop against an image, video, or stream.

{% tabs %}
{% tab title="Node" %}
```shell
npm install --save @eyepop.ai/eyepop
```
{% endtab %}

{% tab title="Browser" %}
```html
<script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop/dist/eyepop.min.js"></script>
```
{% endtab %}

{% tab title="React Native" %}
```shell
npm install --save @eyepop.ai/react-native-eyepop
```
{% endtab %}
{% endtabs %}

### Your first prediction

```typescript
import { EyePop } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            { type: 'inference', ability: 'eyepop.person:latest' },
        ],
    },
}).connect()

try {
    const results = await endpoint.process({ source: { path: 'image.jpg' } })
    for await (const result of results) {
        console.log(result)
    }
} finally {
    await endpoint.disconnect()
}
```

`process()` returns an `AsyncIterable` of predictions. An image normally produces one; a video or animated container produces one per frame.

Pass the Pop when you create the endpoint so EyePop can schedule the right compute before any media is processed.

### Next steps

* [Configuration](configuration.md) — credentials and session options
* [Processing Media](inference.md) — files, streams, URLs, and image groups
* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [Visualization](visualization.md) — draw predictions on a canvas
