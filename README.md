# EyePop.ai Node SDK

The EyePop.ai Node SDK lets Node.js applications process images and videos with EyePop worker sessions.

## Install

```shell
npm install @eyepop.ai/eyepop
```

The SDK is tested with Node 20 LTS and newer.

## Configure

Set your EyePop API key in the server environment:

```shell
export EYEPOP_API_KEY=<your_api_key>
```

API keys are secrets. Do not put `EYEPOP_API_KEY` in browser bundles, mobile app bundles, or public repositories.

## Quickstart

Create `quickstart.mjs`:

```javascript
import { EyePop } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            {
                type: 'inference',
                ability: 'eyepop.person:latest',
                categoryName: 'person',
            },
        ],
    },
}).connect()

try {
    const results = await endpoint.process({
        source: { path: 'examples/example.jpg' },
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

Passing `pop` up front creates a transient worker session with the requested pipeline already scheduled. SDK-created transient sessions use compute-api with `wait=true&transient=true`.

## Configure a Pop

Transient sessions can be configured when the worker endpoint is created, so EyePop can schedule the right compute before media is processed:

```javascript
const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            {
                type: 'inference',
                ability: 'eyepop.person:latest',
                categoryName: 'person',
            },
        ],
    },
}).connect()
```

Use `endpoint.changePop(pop)` when an already connected transient worker needs to switch Pops. Persistent sessions are usually preconfigured; process media directly unless your deployment is intended to accept runtime Pop changes.

## Persistent Sessions

For a provisioned persistent worker session, set the session UUID and connect without a transient pop:

```shell
export EYEPOP_SESSION_UUID=<your_session_uuid>
```

```javascript
const endpoint = await EyePop.workerEndpoint().connect()
```

When `EYEPOP_SESSION_UUID` is set, `EyePop.workerEndpoint()` connects to that persistent session. Persistent deployments are normally created outside the SDK through the compute API or EyePop tooling.

## Module Docs

- [@eyepop.ai/eyepop](src/eyepop/README.md) - Node and browser SDK for worker sessions.
- [@eyepop.ai/eyepop-render-2d](src/eyepop-render-2d/README.md) - Canvas rendering helpers for predictions.
- [@eyepop.ai/react-native-eyepop](src/react-native-eyepop/README.md) - React Native SDK package.
