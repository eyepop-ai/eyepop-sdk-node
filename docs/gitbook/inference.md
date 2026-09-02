---
description: Files, streams, URLs, and image groups
icon: play
---

# Processing Media

`endpoint.process()` accepts a source and returns an `AsyncIterable` of predictions.

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

const stream = fs.createReadStream('image.jpg')
const results = await endpoint.process({
    source: { stream, mimeType: 'image/jpeg' },
})
```

### Public URLs

HTTP(S), RTSP, and RTMP sources are fetched by the server, so nothing uploads from your application.

```typescript
const results = await endpoint.process({
    source: { url: 'https://example.com/video.mp4' },
})
```

### Image groups

A group is a **single** source processed **together** as one inference unit — a multi-image VLM prompt, for example. It returns one prediction for the whole set.

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

Image order is preserved end to end. A group holds **up to 16 images**, enforced server-side. The Pop's ability must be multi-image capable; a single-image ability handed a group returns an error.

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

* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [Visualization](visualization.md) — draw predictions on a canvas
