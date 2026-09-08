---
description: Files, streams, URLs, and image groups
icon: play
---

# Running Inference

`endpoint.process()` accepts a source and returns an `AsyncIterable` of predictions.

This page is the Node call shapes. What a source is, every kind the platform accepts, and the options that shape how one is processed are covered once in [Sources and Options](../../platform/sources-and-options/README.md).

### Local files

```typescript
const results = await endpoint.process({ source: { path: 'image.jpg' } })
for await (const result of results) {
    console.log(result)
}
```

### Readable streams

Streams need an explicit MIME type.

```typescript
import fs from 'node:fs'
import { Readable } from 'node:stream'

const stream = Readable.toWeb(fs.createReadStream('image.jpg'))
const results = await endpoint.process({
    source: { stream, mimeType: 'image/jpeg' },
})
```

### Public URLs

A URL is fetched by the platform, so nothing uploads from your application. [Source Types](../../platform/sources-and-options/sources.md) lists every scheme it accepts.

```typescript
const results = await endpoint.process({
    source: { url: 'https://example.com/video.mp4' },
})
```

### Image groups

A [group](../../platform/sources-and-options/sources.md#image-groups) is one source processed together as a single inference unit, returning one prediction for the whole set.

```typescript
// local files
const results = await endpoint.uploadGroup(['a.jpg', 'b.jpg', 'c.jpg'])

// in-memory streams, with optional parallel MIME types
import fs from 'node:fs'
import { Readable } from 'node:stream'

const a = Readable.toWeb(fs.createReadStream('a.jpg'))
const b = Readable.toWeb(fs.createReadStream('b.jpg'))
const results = await endpoint.uploadStreamGroup([a, b], ['image/jpeg', 'image/jpeg'])

// remote URLs
const results = await endpoint.loadFromGroup([
    'https://example.com/a.jpg',
    'https://example.com/b.jpg',
])
```

[Image groups](../../platform/sources-and-options/sources.md#image-groups) covers the size limit, the ordering guarantee, and which abilities accept a group.

### Canceling jobs

Queued and in-progress jobs can be cancelled from the result iterator.

```typescript
const results = await endpoint.process({
    source: { url: 'https://example.com/video.mp4' },
})

for await (const result of results) {
    console.log(result)
    if ((result.seconds ?? 0) >= 10) {
        results.cancel()
    }
}
```

### Next steps

* [Sources and Options](../../platform/sources-and-options/README.md) — every source the platform accepts, and the options that shape processing
* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [Visualization](visualization.md) — draw predictions on a canvas
