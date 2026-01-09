# TODO

## Code Quality

- Refactor code duplication in `UploadJob.startJob()` method in `src/eyepop/worker/jobs.ts` - FormData and direct stream upload blocks are nearly identical.
- Standardize null/undefined checking patterns across codebase - Mix of `=== undefined`, `!value`, and `== null` patterns. Standardize for consistency and clarity.
- Extract magic numbers to named constants - Token expiry buffer (60s), WebSocket reconnect delays (1000ms, 60000ms), job queue length (1024), etc.

## Examples

- Update example dependencies in `examples/node/package.json` - Currently references `@eyepop.ai/eyepop: ^1.5.2` but current version is `3.8.1`. Consider using workspace protocol.
