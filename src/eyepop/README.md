# EyePop.ai Node SDK

The EyePop.ai Node SDK provides JavaScript and TypeScript access to EyePop worker sessions for image and video inference.

## Installation

### Node

The SDK is tested with Node 20 LTS and newer.

```shell
npm install --save @eyepop.ai/eyepop
```

See the [Node examples](https://github.com/eyepop-ai/eyepop-sdk-node/blob/main/examples/node) for runnable scripts.

### Browser

Browser applications can use the bundled SDK directly:

```html
<script src="https://cdn.jsdelivr.net/npm/@eyepop.ai/eyepop/dist/eyepop.min.js"></script>
```

API keys must not be used in browser code. Browser apps should connect with sessions created by your trusted backend.

### React Native

React Native applications should use the React Native package:

```shell
npm install --save @eyepop.ai/react-native-eyepop
```

See the [React Native example](https://github.com/eyepop-ai/eyepop-sdk-node/tree/main/examples/react_native/upload-example).

## Authentication

The SDK supports these authentication patterns:

- API key authentication for trusted server-side code.
- Persistent worker session selection for provisioned deployments.
- Browser OAuth for dashboard users building local demos.

### Server-Side API Key

Set `EYEPOP_API_KEY` in your server environment. API keys are secrets and must not be exposed in browser bundles, mobile app bundles, or public repositories.

```shell
export EYEPOP_API_KEY=<your_api_key>
```

For provisioned persistent worker sessions, also set `EYEPOP_SESSION_UUID`.

```typescript
import { EyePop } from '@eyepop.ai/eyepop'

;(async () => {
    const endpoint = await EyePop.workerEndpoint().connect()
    try {
        await endpoint.changePop({
            components: [
                {
                    type: 'inference',
                    model: 'eyepop.person:latest',
                    categoryName: 'person',
                },
            ],
        })

        const results = await endpoint.process({ source: { path: 'examples/example.jpg' } })
        for await (const result of results) {
            console.log(result)
        }
    } finally {
        await endpoint.disconnect()
    }
})()
```

You can also pass the key explicitly from server-side configuration:

```typescript
const endpoint = await EyePop.workerEndpoint({
    auth: { apiKey: process.env.EYEPOP_API_KEY },
}).connect()
```

### Persistent Sessions

If EyePop has provisioned a persistent worker session for your deployment, set `EYEPOP_SESSION_UUID` in the trusted server environment or pass `sessionUuid` explicitly.

```shell
export EYEPOP_API_KEY=<your_api_key>
export EYEPOP_SESSION_UUID=<your_session_uuid>
```

```typescript
import { EyePop } from '@eyepop.ai/eyepop'

;(async () => {
    const endpoint = await EyePop.workerEndpoint({
        sessionUuid: process.env.EYEPOP_SESSION_UUID,
    }).connect()

    try {
        const results = await endpoint.process({ source: { path: 'sample.mp4' } })
        for await (const result of results) {
            console.log(result)
        }
    } finally {
        await endpoint.disconnect()
    }
})()
```

Persistent sessions are normally preconfigured. In that case, process media directly and do not call `changePop()` unless your deployment is meant to accept runtime Pop changes.

### Browser and Mobile Clients

Do not put `EYEPOP_API_KEY` in browser or mobile application code. Create EyePop sessions from a trusted backend, then pass only the session JSON to the client.

### Browser OAuth for Local Dashboard Demos

Dashboard users can run local browser demos with the current browser session:

```html
<script>
    document.addEventListener('DOMContentLoaded', async () => {
        const endpoint = await EyePop.workerEndpoint({ auth: { oAuth2: true } }).connect()
        try {
            await endpoint.changePop({
                components: [
                    {
                        type: 'inference',
                        model: 'eyepop.person:latest',
                        categoryName: 'person',
                    },
                ],
            })
        } finally {
            await endpoint.disconnect()
        }
    })
</script>
```

## Processing Media

### Local Files

```typescript
const results = await endpoint.process({ source: { path: 'examples/example.jpg' } })
for await (const result of results) {
    console.log(result)
}
```

`process()` returns an `AsyncIterable` of predictions. Images normally produce one prediction. Videos and animated image containers produce one prediction per frame.

### Readable Streams

Streams require an explicit MIME type:

```typescript
import fs from 'node:fs'

const stream = fs.createReadStream('examples/example.jpg')
const results = await endpoint.process({
    source: { stream, mimeType: 'image/jpeg' },
})
```

### Public URLs

Public HTTP(S), RTSP, and RTMP URLs can be processed without uploading the file from your application.

```typescript
const results = await endpoint.process({
    source: { url: 'https://demo-eyepop-videos.s3.amazonaws.com/test1_vlog.mp4' },
})
```

### Canceling Jobs

Queued and in-progress jobs can be cancelled from the result iterator:

```typescript
const results = await endpoint.process({
    source: { url: 'https://demo-eyepop-videos.s3.amazonaws.com/test1_vlog.mp4' },
})

for await (const result of results) {
    console.log(result)
    if ((result.seconds ?? 0) >= 10) {
        results.cancel()
    }
}
```

## Endpoint Options

By default, `EyePop.workerEndpoint().connect()` starts a worker when needed and cancels queued jobs on that worker when it connects.

Disable worker startup:

```typescript
const endpoint = await EyePop.workerEndpoint({ autoStart: false }).connect()
```

Keep pending jobs:

```typescript
const endpoint = await EyePop.workerEndpoint({ stopJobs: false }).connect()
```

## Visualization

Rendering helpers are provided by [@eyepop.ai/eyepop-render-2d](https://www.npmjs.com/package/@eyepop.ai/eyepop-render-2d).

## Data Endpoint Preview

`EyePop.dataEndpoint()` provides preview support for dataset management and model optimization workflows. This API is experimental and subject to change.

## Composable Pops Preview

See [Composable Pops](composable-pops.md) for a preview of client-side Pop composition.
