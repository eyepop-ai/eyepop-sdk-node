---
description: Credentials and session options
icon: gear
---

# Configuration

Set `EYEPOP_API_KEY` in your server environment. API keys are secrets — keep them out of browser bundles, mobile app bundles, and public repositories.

```shell
export EYEPOP_API_KEY=eyp_...
```

The SDK reads it automatically. You can also pass credentials explicitly at the **top level** of the endpoint options:

```typescript
const endpoint = await EyePop.workerEndpoint({
    apiKey: process.env.EYEPOP_API_KEY,
}).connect()
```

`apiKey`, `accessToken`, `session`, and `oAuth2` are all accepted this way.

{% hint style="warning" %}
The nested `auth` option is deprecated. Pass the credential at the top level in new code.
{% endhint %}

### Transient and persistent sessions

With no session UUID the SDK creates a new **transient** session each time it connects, and deletes the pipeline it created on disconnect — the right default for building and testing. It does not delete the session itself.

Connecting without a `pop` behaves differently: the SDK attaches to your first live non-persistent session instead of creating one.

To run against a persistent Deployment, set `EYEPOP_SESSION_UUID` or pass `sessionUuid`. The Pop is fixed when the Deployment is created, so you do not pass one:

```typescript
const endpoint = await EyePop.workerEndpoint({
    sessionUuid: '<your-session-uuid>',
}).connect()
```

### Browser and mobile clients

Never ship an API key in client code. Create the session on a trusted backend and pass only the session JSON to the client, which connects with `session`.

### Local mode

An [on-premise instance](https://docs.eyepop.ai/deploying/on-premise) serves the EyePop runtime on your own machine. **Local mode** points the SDK at `http://127.0.0.1:8080` instead of the cloud and needs no account credentials — the instance is already registered to your account, and reaching the loopback port is what authorizes the client. An `EYEPOP_API_KEY` in the environment is still sent if it is set; unset it to connect anonymously.

```typescript
import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    isLocalMode: true,
    pop: {
        components: [
            { type: PopComponentType.INFERENCE, ability: 'eyepop.person:latest' },
        ],
    },
}).connect()
```

`EYEPOP_LOCAL_MODE=true` in the environment selects it without the option. Local mode always uses port `8080`, so leave the instance on its default port when Node clients connect to it.

Connecting creates a pipeline on the instance and disconnecting removes it, so disconnect in a `finally` and reuse one connected endpoint for many images.

### Endpoint options

By default a transient worker starts when needed and queued jobs on that worker are cancelled at connect.

```typescript
// leave the worker alone
const endpoint = await EyePop.workerEndpoint({ pop, autoStart: false }).connect()

// keep pending jobs
const endpoint = await EyePop.workerEndpoint({ pop, stopJobs: false }).connect()
```

### Next steps

* [Running Inference](inference.md) — submit files, streams, and URLs
* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [On-Premise](https://docs.eyepop.ai/deploying/on-premise) — create an instance to run local mode against
