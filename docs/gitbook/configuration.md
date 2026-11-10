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

### Login tokens

`accessToken` and `oAuth2` hold a login token, as from your dashboard.eyepop.ai account. The SDK exchanges it at the compute API (`POST /v1/auth/authenticate`) for a token that carries your account, sends that token, and exchanges again when it expires or a request or a pipeline mode socket is answered 401, retrying once. Name the account with `accountId` when your login has more than one. A token that already carries an account (the `https://ident.eyepop.ai/account-uuid` claim, read without checking the signature) is used as it is, with no exchange, and so is a token the compute API refuses with "API key or user login required". Any other refusal is raised, including an expired or invalid login (`AUTH_001`, "Authentication failed"), `AUTHZ_001` for an account you may not use, and a server error.

### Transient and persistent sessions

With no session UUID and a `pop` — the flow every example here uses — the SDK creates a new **transient** session each time it connects, and deletes the pipeline it created on disconnect. It does not delete the session itself. This is the right default for building and testing.

With no `pop`, the SDK reuses your first live non-persistent session if you have one, and creates a new session otherwise.

### Account

A session runs and is billed under one account. When your credential belongs to more than one account, name the account with `EYEPOP_ACCOUNT_UUID` or the `accountId` option — the same option the data endpoint takes. The SDK sends it as `account_uuid` when it creates a session, and reuses only a live session of that account. Without it, the compute API refuses to create a session it cannot attribute, with `VAL_001: account_uuid is required`.

```typescript
const endpoint = await EyePop.workerEndpoint({
    accountId: '<your-account-uuid>',
}).connect()
```

Pipeline mode is the default; it runs no worker session. To run against a persistent Deployment, turn it off (`isPipelineMode: false` or `EYEPOP_PIPELINE_MODE=false`) and set `EYEPOP_SESSION_UUID` or pass `sessionUuid`. The Pop normally comes from the Deployment, so you do not pass one:

```typescript
const endpoint = await EyePop.workerEndpoint({
    sessionUuid: '<your-session-uuid>',
    isPipelineMode: false,
}).connect()
```

Pick the pipeline API with `EYEPOP_ENV=staging|production|local`.

### Browser and mobile clients

Never ship an API key in client code. Create the session on a trusted backend and pass only the session JSON to the client, which connects with `session`.

### Local mode

An [on-premise instance](https://docs.eyepop.ai/developer-documentation/cli/on-premise) serves the EyePop runtime on your own machine. **Local mode** points the SDK at `http://127.0.0.1:8080` instead of the cloud and needs no account credentials — the instance is already registered to your account, and reaching the loopback port is what authorizes the client. An `EYEPOP_API_KEY` in the environment is still sent if it is set; unset it to connect anonymously.

The instance serves one Pop, chosen when it is set up with `eyepop instance init` and changed with `eyepop instance set`, so you do not pass one from the SDK:

```typescript
import { EyePop } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    isLocalMode: true,
}).connect()
```

`EYEPOP_LOCAL_MODE=true` in the environment selects it without the option. Local mode on an instance is a worker session, so it needs `isPipelineMode: false` (or `EYEPOP_PIPELINE_MODE=false`). With it off here, local mode always uses port `8080`, so leave the instance on its default port when Node clients connect to it. In pipeline mode, the default, local mode means a local pipeline API on `http://127.0.0.1:9002` instead, or `EYEPOP_URL` when set, not an instance; `EYEPOP_ENV=local` picks `http://localhost:8080`.

The endpoint runs on the instance's own pipeline and leaves it running when it disconnects. Disconnect in a `finally`, and reuse one connected endpoint for many images rather than connecting for each.

### Next steps

* [Running Inference](inference.md) — submit files, streams, and URLs
* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [On-Premise Instances](https://docs.eyepop.ai/developer-documentation/cli/on-premise) — set up an instance with the CLI to run local mode against
