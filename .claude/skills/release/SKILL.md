---
name: release
description: Cut a release of eyepop-sdk-node — pick the version, bump the three workspaces, publish a GitHub Release, verify npm. Use when asked to release, publish, cut a version, or ship the SDK.
---

# Releasing eyepop-sdk-node

Publishing is triggered by **publishing a GitHub Release**, nothing else. `.github/workflows/npm-publish.yml`
builds, tests, then publishes every workspace whose `name@version` is not already on npm — so it is idempotent
and safe to re-run.

## 1. Pick the version

All three workspaces share one version with exact inter-pins. Do not trust the changelog's `[Unreleased]`
section — it has shipped stale before. Check what actually changed:

```bash
git fetch origin --tags && git log $(gh release view --json tagName --jq .tagName)..origin/main --oneline
```

```bash
git diff --stat $(gh release view --json tagName --jq .tagName) origin/main -- src/
```

Only `src/` changes reach consumers. Docs, examples, CI, and `.claude/` do not justify a release at all.
Fixes only → patch. New exported types or APIs → minor.

## 2. Merge what is going out

`main` requires 1 approving review and GitHub forbids approving your own PR. `enforce_admins` is `false`, so
an admin can bypass — a real bypass of the org's review rule, so confirm with the user before using it:

```bash
gh pr merge <N> --squash --admin
```

## 3. Bump the version and roll the changelog

Bump `version` in all three `src/*/package.json` **and** the `@eyepop.ai/*` inter-pins inside
`eyepop-render-2d` and `react-native-eyepop`. Leaving a pin behind publishes a package that depends on a
version that does not exist.

```bash
npm version 3.19.1 --workspaces --no-git-tag-version && npm install
```

`npm version --workspaces` does not rewrite the inter-pins — check and fix them by hand:

```bash
grep -rn '"@eyepop.ai/' src/*/package.json
```

In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty
`## [Unreleased]` above it.

## 4. Verify before tagging

```bash
npm run typecheck && task check
```

`task check` mirrors `.github/workflows/ci.yml`: both workspace builds, the react-native typecheck, and Jest
in band. CI additionally runs `npm run typecheck`, which `task check` does not — run both.

## 5. Commit, push, release

Branch protection blocks direct pushes to `main` for non-admins; an admin push is the normal path for the
release commit.

```bash
git commit -am "chore(release): 3.19.1" && git push origin HEAD:main
```

```bash
gh release create v3.19.1 --target main --title "v3.19.1" --notes-file notes.md
```

`--target` takes a **branch name**. Passing a commit SHA fails with `Release.target_commitish is invalid`.
Point it at `main` after the release commit has landed there. Tag format is `vX.Y.Z`.

## 6. Confirm it published

```bash
gh run list --workflow=npm-publish.yml --limit 1
```

```bash
for p in @eyepop.ai/eyepop @eyepop.ai/eyepop-render-2d @eyepop.ai/react-native-eyepop; do npm view "$p@3.19.1" version; done
```

An `E404` right after a release usually means npm has not finished indexing, not that the publish failed —
the log prints `Your package is being processed and may take a few minutes to become available.` Confirm
against the publish step's log before concluding anything: a successful publish ends with `+ <name>@<version>`.
Packages can appear minutes apart.

The publish step silently skips any `name@version` already on the registry, so a green run does not by itself
prove a new version went out — the version in `src/*/package.json` has to have been bumped.
