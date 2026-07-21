# Contributing

## Local verification

Build the source SDK before running tests that import `src/eyepop`, because the package entrypoint resolves to `src/eyepop/dist/eyepop.index.js`.

```shell
npm --workspace @eyepop.ai/eyepop run build
npx jest --runInBand --testPathIgnorePatterns="<rootDir>/.worktrees"
```

## Staging session integration

Run the staging session matrix locally before dispatching the `SDK Integration` workflow. The local equivalent of the workflow's staging `EYEPOP_API_KEY` secret is `ACTIONS_EYEPOP_API_KEY` from `$EYEPOP_ROOT/.keys/staging`.

```shell
KEY=$(grep -E '^ACTIONS_EYEPOP_API_KEY=' "$EYEPOP_ROOT/.keys/staging" | head -1 | cut -d= -f2- | tr -d '"')

EYEPOP_API_KEY="$KEY" node scripts/session-smoke.mjs \
  --environment staging \
  --scenario all-transient \
  --cleanup-preexisting \
  --sdk-module ./src/eyepop/dist/eyepop.index.js \
  --session-name "node-local-staging-$(date +%s)" \
  --session-ready-timeout-seconds 180 \
  --gpu-image tests/test.jpg \
  --gpu-ability dot-gov-com.object-detection.person:latest \
  --gpu-expected-class person \
  --gpu-min-objects 1 \
  --gpu-min-confidence 0.5 \
  --cpu-image tests/test.jpg \
  --cpu-pop-file tests/fixtures/pops/localize-objects-modeless.json \
  --cpu-expected-class person \
  --cpu-min-objects 0 \
  --cpu-min-confidence 0 \
  --vlm-image tests/fixtures/images/angrykitten.jpg \
  --vlm-pop-file tests/fixtures/pops/find-kittens-vlm.json \
  --vlm-expected-class EXPLODED \
  --vlm-min-objects 1 \
  --vlm-min-confidence 0 \
  --summary-json /tmp/node-sdk-staging-integration.json
```

For the VLM-only slice, change `--scenario all-transient` to `--scenario vlm-direct`. Use `EYEPOP_API_KEY_LP` only when testing the basic dot-gov user fixture directly; it is not the GitHub Actions integration key.
