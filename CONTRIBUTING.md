# Contributing

## Local verification

Build the source SDK before running tests that import `src/eyepop`, because the package entrypoint resolves to `src/eyepop/dist/eyepop.index.js`.

```shell
npm --workspace @eyepop.ai/eyepop run build
npx jest --runInBand --testPathIgnorePatterns="<rootDir>/.worktrees"
```

## Session integration

Run the session matrix locally before dispatching the `SDK Integration` workflow. Copy `.env.example` to `.env` and set `EYEPOP_API_KEY` to a key for the account you want to exercise; the smoke script loads `.env` when the variable is not already exported.

```shell
node scripts/session-smoke.mjs \
  --scenario all-transient \
  --cleanup-preexisting \
  --sdk-module ./src/eyepop/dist/eyepop.index.js \
  --session-name "node-local-$(date +%s)" \
  --session-ready-timeout-seconds 180 \
  --gpu-image tests/test.jpg \
  --gpu-ability eyepop.person:latest \
  --gpu-expected-class person \
  --gpu-min-objects 1 \
  --gpu-min-confidence 0.5 \
  --cpu-image tests/test.jpg \
  --cpu-pop-file tests/fixtures/pops/localize-objects-modeless.json \
  --cpu-expected-class person \
  --cpu-min-objects 0 \
  --cpu-min-confidence 0 \
  --vlm-image tests/test.jpg \
  --vlm-ability eyepop-ai-eyepop-basic.describe.image:latest \
  --vlm-expected-class description \
  --vlm-min-objects 0 \
  --vlm-min-confidence 0 \
  --vlm-min-texts 1 \
  --summary-json /tmp/node-sdk-integration.json
```

For the VLM-only slice, change `--scenario all-transient` to `--scenario vlm-direct`. Add `--environment staging` to target staging instead of the default.

Pops that depend on account-private abilities are not documented here — point the `--*-ability` and `--*-pop-file` flags at fixtures your own account owns.
