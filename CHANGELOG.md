---
latest_version: 0.1.1
released: 2026-07-01
---

# OneBrain WebUI Changelog

All notable changes to the OneBrain WebUI — the 2D CMS shell served by the OneBrain daemon (`onebrain serve`) and embedded into the `onebrain` CLI binary.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Versioning:** WebUI version is tracked in `package.json` and baked into the bundle at build time (shown in Settings → About). The `dist` is published as a versioned tarball on GitHub Releases; `onebrain-cli` embeds a pinned release, verified by sha256.
> For CLI binary changes, see [`onebrain-ai/onebrain-cli`](https://github.com/onebrain-ai/onebrain-cli/blob/main/CHANGELOG.md); for the vault-deployed plugin, see [`onebrain-ai/onebrain`](https://github.com/onebrain-ai/onebrain/blob/main/CHANGELOG.md).

## [Unreleased]

## [0.1.1] — 2026-07-01

### Added

- **`version.json` in the build output.** A Vite plugin emits `dist/version.json` (`{"version":"…"}`, from `package.json`) alongside the bundle, so consumers of the embedded `dist` — notably `onebrain serve` — can report the running WebUI version without parsing the minified JS. Complements the baked-in `__APP_VERSION__` (Settings → About).
- **`changelog.json` in the build output.** A Vite plugin parses `CHANGELOG.md` into structured JSON (`{latest, released, entries:[{version, date, markdown}]}`) and emits `dist/changelog.json`, so the WebUI can render a "What's new" view from the embedded dist without shipping a markdown parser for the changelog.
- **Test coverage tooling + suite.** Added `@vitest/coverage-v8`, a `coverage` config block (v8 provider, `text` + `html` reporters, excludes for test files / `*.d.ts` / the `main.tsx` bootstrap), and a `test:coverage` npm script. Raised coverage from a ~39% statements baseline to **100% statements / branches / functions / lines** across `core/`, `panels/`, `shells/`, and `ui/`. Genuinely-unreachable defensive branches (`?? ""` on non-null DOM APIs, jsdom-uncontrollable image state, compile-time constants) are annotated with `/* v8 ignore */` + a reason; provably-dead code was removed. A CI coverage gate enforces the 100% thresholds so coverage can't regress.
- **WebUI version in Settings → About.** The running build's version (from `package.json`, injected via Vite `define` as `__APP_VERSION__`) is shown in the Settings modal, so it's clear which build is live.
- **This changelog**, following the `onebrain-cli` / `onebrain` convention.

## [0.1.0] — 2026-06-30

### Added

- **2D CMS shell (`CmsShell`)** — the universal surface for the OneBrain daemon: explorer, editor (CodeMirror + live markdown preview), search, tasks, chat, memory, skills, and file-preview panels, wired to the daemon's JSON API.
- **Offline-first `dist`** — self-hosted fonts, no external CDN references (enforced by `scripts/check-offline.mjs`), embedded verbatim into the `onebrain` CLI binary and served via `onebrain serve`.
- Dual-licensed `MIT OR Apache-2.0`.
