# Changelog

## [Unreleased]

## [3.19.1] - 2026-09-03

### Added

- Frame-level `depth` prediction member (`Depth` type) as produced by depth estimation abilities (e.g. `eyepop.depth.*`): base64 little-endian float32 map with the source frame's aspect ratio, sky pixels as `+Infinity`. `decodeDepthMap()` returns a `DepthMap` with typed values, finite min/max, and proportional source-coordinate sampling (`at()`, `isSky()`).
- `Render2d.renderDepth()`: turbo-colormap depth heatmap overlay (near = warm, far = cool, sky untouched by default), portable across node-canvas, browser, and react-native canvases.
- The `Mask` type is now exported from `@eyepop.ai/eyepop`.

### Fixed

- Compute session connection errors now preserve structured pipeline failure details from Compute API responses and sessions.
- Dataset event WebSocket failures now report the structured `EyePopDataWebSocketError` instead of rejecting with a raw browser event, and background reconnect failures no longer surface as unhandled promise rejections.
- Dataset event subscriptions are replayed after a reconnect; previously a reconnected session received only account-level events.
- The core package declares its direct `url-join` dependency, which previously reached the build only through workspace hoisting.
