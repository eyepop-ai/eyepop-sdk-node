# EyePop.ai Node SDK

The EyePop.ai Node SDK lets Node.js applications process images and videos with EyePop worker sessions.

## Install

```shell
npm install @eyepop.ai/eyepop
```

The SDK supports Node.js 18 and newer.

## Configure

Set your EyePop API key in the server environment:

```shell
export EYEPOP_API_KEY=<your_api_key>
```

For a provisioned persistent worker session, also set the session UUID:

```shell
export EYEPOP_SESSION_UUID=<your_session_uuid>
```

API keys are secrets. Do not put `EYEPOP_API_KEY` in browser bundles, mobile app bundles, or public repositories.

## Quickstart

Create `quickstart.mjs`:

```javascript
import { EyePop } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint().connect()

try {
    const results = await endpoint.process({
        source: { path: 'sample.mp4' },
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

When `EYEPOP_SESSION_UUID` is set, `EyePop.workerEndpoint()` connects to that persistent session. Otherwise it creates a transient worker session.

## Configure a Pop

Transient sessions can be configured in code before processing media:

```javascript
await endpoint.changePop({
    components: [
        {
            type: 'inference',
            model: 'eyepop.person:latest',
            categoryName: 'person',
        },
    ],
})
```

Persistent sessions are usually preconfigured. Process media directly unless your deployment is intended to accept runtime Pop changes.

## Module Docs

- [@eyepop.ai/eyepop](src/eyepop/README.md) - Node and browser SDK for worker sessions.
- [@eyepop.ai/eyepop-render-2d](src/eyepop-render-2d/README.md) - Canvas rendering helpers for predictions.
- [@eyepop.ai/react-native-eyepop](src/react-native-eyepop/README.md) - React Native SDK package.
