# eyepop-sdk-node

Official Node.js / TypeScript SDK for EyePop.ai's inference API — connect to worker sessions and process
images/videos through vision pipelines ("Pops"). npm-workspaces monorepo (`src/eyepop`, `src/eyepop-render-2d`, `src/react-native-eyepop`).

## Commands
Use npm workspaces (not pnpm/yarn). Install dependencies with `npm install`. Before done, run
`task check`, which mirrors `.github/workflows/ci.yml`: build `@eyepop.ai/eyepop` and
`eyepop-render-2d`, typecheck `react-native-eyepop`, then run Jest in-band.

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
- The supported runtime floor is Node.js 18. CI validates Node.js 22 and the publish workflow uses Node.js 24.
- `lefthook.yml` ships entirely commented out — **no hooks are configured**, so nothing auto-runs lint/tests
  locally even if a lefthook shim is installed in `.git/hooks`.
