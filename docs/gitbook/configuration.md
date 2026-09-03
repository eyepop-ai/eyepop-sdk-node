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

With no session UUID the SDK creates a **transient** session on connect and releases it on disconnect — the right default for building and testing.

To run against a persistent Deployment, set `EYEPOP_SESSION_UUID` or pass `sessionUuid`. The Pop is fixed when the Deployment is created, so you do not pass one:

```typescript
const endpoint = await EyePop.workerEndpoint({
    sessionUuid: '<your-session-uuid>',
}).connect()
```

### Browser and mobile clients

Never ship an API key in client code. Create the session on a trusted backend and pass only the session JSON to the client, which connects with `session`.

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
