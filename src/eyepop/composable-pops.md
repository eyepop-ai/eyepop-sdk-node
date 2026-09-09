# Composable Pops

Building rich inference pipelines by combining prebuilt abilities with custom trained models.

The complete component reference is published under Platform → Pops: **[Components](https://docs.eyepop.ai/platform/pop-components)** for every component type and its attributes, **[Forwarding](https://docs.eyepop.ai/platform/pop-forwarding)** for how they chain, and **[Examples](https://docs.eyepop.ai/platform/pop-examples)** for worked pipelines.

For the Node construction API specifically — the exported types and how to pass a Pop to `EyePop.workerEndpoint()` — see [`docs/gitbook/composable-pops.md`](../../docs/gitbook/composable-pops.md) in this repository.

## A minimal Pop

```typescript
import { EyePop, PopComponentType } from '@eyepop.ai/eyepop'

const endpoint = await EyePop.workerEndpoint({
    pop: {
        components: [
            { type: PopComponentType.INFERENCE, ability: 'eyepop.person:latest' },
        ],
    },
}).connect()
```

Name abilities with `ability` (an alias such as `eyepop.person:latest`) or `abilityUuid` (a custom trained model). The older `model` and `modelUuid` spellings are still accepted.
