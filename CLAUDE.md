# eyepop-sdk-node

Official Node.js / TypeScript SDK for EyePop.ai's inference API — connect to worker sessions and process
images/videos through vision pipelines ("Pops"). npm-workspaces monorepo (`src/eyepop`, `src/eyepop-render-2d`, `src/react-native-eyepop`).

## Commands
npm workspaces (not pnpm/yarn/go-task). No single check task. Unit tests: `npm test` (jest, fully mocked).
Before done, mirror CI (`.github/workflows/ci.yml`, Node 22): build `@eyepop.ai/eyepop` + `eyepop-render-2d`,
`typecheck` `react-native-eyepop`, then `npx jest --runInBand`.

## Gotchas
- Dual node+browser codebase: `build` = `tsup` (CJS+ESM+dts) then `webpack` browser bundle; the `browser` field
  stubs Node built-ins (`fs`, `undici`, `ws` → false). Those overrides are load-bearing — don't assume Node APIs are safe.
- Jest runs ESM against raw TS `src/` (no build needed), but relative imports must carry a `.js` extension
  (ESM convention) even though the files are `.ts` — omitting it breaks resolution.
- Unit tests are hermetic (mock server / fake HttpClient); the smoke/live tests (`npm run smoke:session`,
  `scripts/session-smoke.mjs`) hit real hosts and need `EYEPOP_API_KEY` — exported, or in a `.env` copied
  from `.env.example`. Its default abilities must stay account-portable; no private fixtures.
- Publish is GitHub-Release-triggered and idempotent (skips any `name@version` already on npm). All three
  workspaces share one version with exact inter-pins — bump them in lockstep; `react-native-eyepop` has its own `release-it` path.
- Version pins disagree (`engines` ≥18, READMEs say 20, `ci.yml` uses 22, `npm-publish.yml` uses 24) and
  `lefthook.yml` ships entirely commented out — **no hooks are configured**, so nothing auto-runs lint/tests
  locally even if a lefthook shim is installed in `.git/hooks`.
