---
description: Files, streams, URLs, and image groups
icon: play
---

# Running Inference

`endpoint.process()` accepts a source and resolves to a `ResultStream`, an `AsyncIterable` of predictions.

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
const fileGroupResults = await endpoint.uploadGroup(['a.jpg', 'b.jpg', 'c.jpg'])

// readable streams, with optional parallel MIME types
import fs from 'node:fs'
import { Readable } from 'node:stream'

const a = Readable.toWeb(fs.createReadStream('a.jpg'))
const b = Readable.toWeb(fs.createReadStream('b.jpg'))
const streamGroupResults = await endpoint.uploadStreamGroup([a, b], ['image/jpeg', 'image/jpeg'])

// remote URLs
const urlGroupResults = await endpoint.loadFromGroup([
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

### Camera calibration

`process()` and the group methods take a `camera`, which is what lets a [depth map](../../platform/depth-and-world-coordinates/depth-maps.md) become positions in meters:

```typescript
const results = await endpoint.process({
    source: { url: 'rtsp://camera.example.com/stream1' },
    camera: { hfovDegrees: 72 },
})
```

Set it once for every source with `pop.defaults` instead — see [Composable Pops](composable-pops.md#world-coordinates).

### Recordings: thumbnails and clips

A source with `mediaCacheSeconds` is recorded to the media cache, and its job's `mediaId` names the recording once the source starts. The endpoint reads it back by that `mediaId`: in pipeline mode from the pipeline API, on a worker session from the session's instance. A recording outlives its job, its socket and its session; once a session has ended, read its `mediaId` with a pipeline mode endpoint of the same account.

```typescript
const results = await endpoint.process({
    source: { url: 'rtsp://camera.example.com/stream1' },
    mediaCacheSeconds: 3600,
})

for await (const prediction of results) {
    for (const object of prediction.objects ?? []) {
        // the frame this prediction was made on, cropped to the object, at most 160 by 160, as JPEG bytes
        const thumbnail = await results.mediaFrame(prediction, object, { maxWidth: 160, maxHeight: 160 })
    }
}

const mediaId = results.mediaId!
const { startNs, endNs } = await endpoint.mediaRange(mediaId)
const clip = await endpoint.mediaClip(mediaId, startNs, Math.min(endNs, startNs + 60e9))
// clip.stream is the MP4 as it arrives; clip.startNs and clip.endNs are its real bounds
```

- `endpoint.mediaRange(mediaId)` answers `{ startNs, endNs }`, the first and last nanosecond the cache still holds.
- `endpoint.mediaFrame(mediaId, timestampNs, options)` answers the frame at a prediction's `timestamp` as a `Uint8Array`: JPEG, or PNG with `png: true`; cropped to `bbox` (`x`, `y`, `width`, `height` in the frame's pixels); fit to `maxWidth` and `maxHeight`, aspect kept and never enlarged.
- `endpoint.mediaClip(mediaId, startNs, endNs, options)` answers `{ stream, startNs, endNs, milliComputeUnits }`: `mode: 'exact'` (the default) re-encodes the window to its exact bounds, `mode: 'keyframe'` copies it from the keyframe at or before `startNs` without encoding. The server caps a window, 300 s by default.
- `results.mediaFrame(prediction, object?, options?)` is `mediaFrame` at the prediction's `timestamp`, cropped to the object's box. An object's coordinates are in the prediction's source pixels, which are the recorded frame's.

Timestamps are nanoseconds from the start of the source's media, as predictions carry them. A number holds them exactly up to 2^53 ns, about 104 days; the reads also take a `bigint`, and refuse a number that is not a safe integer.

A frame read right after its prediction often finds the moment not cached yet: the server waits up to `waitMs` (2000 by default, at most 10000) and then answers `425` with `Retry-After`, after which the SDK asks again until `deadlineMs` (30000 by default) has passed. Any other refusal throws `MediaReadError` with the HTTP `status` and the server's `error`, `reason` and `serverMessage`; `reason` is the code to act on, for example `stream_not_found` (404), `media_expired` (410), `clip_too_long` (400) or `media_cache_not_configured` (503).

The pipeline API prices each read in milli compute units, in a dry run for now; a worker session's reads are part of its session minutes. The pipeline's warnings about a source, such as `media_cache_gop_too_long` for a camera that sends keyframes too rarely, are on the job's `warnings` in both modes and logged.

### Next steps

* [Sources and Options](../../platform/sources-and-options/README.md) — every source the platform accepts, and the options that shape processing
* [Composable Pops](composable-pops.md) — chain models into a pipeline
* [Visualization](visualization.md) — draw predictions on a canvas
* [Depth and World Coordinates](../../platform/depth-and-world-coordinates/README.md) — depth maps, calibration, and meters
