---
latest_version: 0.1.6
released: 2026-07-02
---

# OneBrain WebUI Changelog

All notable changes to the OneBrain WebUI — the 2D CMS shell served by the OneBrain daemon (`onebrain serve`) and embedded into the `onebrain` CLI binary.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Versioning:** WebUI version is tracked in `package.json` and baked into the bundle at build time (shown in Settings → About). The `dist` is published as a versioned tarball on GitHub Releases; `onebrain-cli` embeds a pinned release, verified by sha256.
> For CLI binary changes, see [`onebrain-ai/onebrain-cli`](https://github.com/onebrain-ai/onebrain-cli/blob/main/CHANGELOG.md); for the vault-deployed plugin, see [`onebrain-ai/onebrain`](https://github.com/onebrain-ai/onebrain/blob/main/CHANGELOG.md).

## [Unreleased]

## [0.1.6] — 2026-07-02

### Added

- **Internal webview.** Clicking an external web link in the markdown reading view now opens the site in an in-app iframe with a close (×) button that returns to the document, instead of leaving for a new tab. Two layouts — pane takeover, and a side split that keeps the document visible alongside — toggle from the webview header (the choice persists). Sites that refuse framing (`X-Frame-Options` / CSP `frame-ancestors`) fall back to a new tab after a confirmation dialog (which doubles as a fresh user gesture, so popup blockers can't eat the tab), as does an 8-second load-hang timer. Wikilinks, `#anchors`, and `mailto:` links are unaffected. Framability is decided by a daemon preflight (`GET /api/webview/preflight`); the iframe is sandboxed (`allow-scripts allow-forms allow-popups allow-same-origin`, `referrerpolicy=no-referrer`).
- **External-link icons in the reading view.** Every external `http(s)` link now carries a small trailing glyph — a brand mark for recognised sites (Wikipedia, GitHub, YouTube, X, Reddit, Stack Overflow, npm, Discord, Google, OpenAI, Anthropic/Claude, …; path data vendored from simple-icons, drawn in each brand's official color) or a generic arrow-out — so external vs wikilink/internal is visible before clicking. Inline SVG only: rendering never fetches favicons (no third-party pings, no broken images behind DNS filters). Wikilinks, `mailto:`, and relative links are unmarked.
- **Webview: in-frame back/forward, resizable side split, reload.** ← → header buttons walk the framed site's own navigation history (joint-session-history steering — the frame's cross-origin history can't be touched directly; depth is tracked via frame load events, with a safety valve against a no-op back). ⟳ remounts the frame back to the original page. The side split is drag-resizable from its left edge (width persists).
- **Checkerboard ⇄ plain background toggle for transparent previews.** The rich-viewport toolbar (png/gif/svg/drawio/pptx) gains a pattern button next to the light/dark toggle — switch the transparency checkerboard off for a flat tone in the chosen shade. Persisted (`onebrain.previewPlainBg`).

## [0.1.5] — 2026-07-01

### Changed

- **Settings modal → categorized two-pane console.** The single long scroll is now a left category rail (tablist: Appearance · Preview · Vault · About) + a content pane, so it stays tidy as settings grow. The rail is keyboard-navigable (arrow / Home / End roving `tabindex`), each category has an icon + a titled pane header, and the active category persists across opens (`onebrain.settingsCat`). Controls adopt the DS chamfer clips + accent active-state; segmented buttons and swatches are unchanged in behaviour.

### Added

- **Settings search.** A search box filters the editable settings (theme, accent, density, HTML autorun, media autoplay) across categories into a live results list.
- **About → "What's new".** The About pane renders the latest changelog entry (fetched from the emitted `/changelog.json`) plus a "Full changelog →" link to `CHANGELOG.md`, alongside the WebUI version, daemon-connection status, and a repository link. A dev-server middleware now serves `/changelog.json` in `npm run dev` too (previously build-only), so the panel behaves identically in dev and prod. New `__APP_REPO__` build constant (from `package.json` `homepage`).

## [0.1.4] — 2026-07-01

### Fixed

- **Accessibility & SEO (Lighthouse).** CodeMirror editor + read-only source views now expose an `aria-label` (WCAG 4.1.2); the viewport meta no longer disables zoom (`user-scalable=no` / `maximum-scale` removed, WCAG 1.4.4); a `<meta name="description">` was added; and three sub-10px labels (topbar eyebrow, explorer file-count, file-extension) move from `--color-ghost` to the `--color-faint` token so they meet the 4.5:1 contrast ratio (WCAG 1.4.3) — the global ghost token is unchanged. Desktop Lighthouse: **Accessibility 86 → 100**, SEO 82 → 91, Best Practices 100, Performance 99.

## [0.1.3] — 2026-07-01

### Added

- **Complete `THIRD-PARTY-NOTICES.txt`.** `rollup-plugin-license` emits attribution for every bundled JS dependency (direct + transitive — Apache-2.0 `xlsx` / `@maxgraph/core` / `@aiden0z/pptx-renderer`, `dompurify`, all the MIT/BSD/Zlib libs) with verbatim license text. `scripts/append-untracked-notices.mjs` then adds the works the JS bundler can't see: the CSS-imported `@fontsource` fonts (SIL OFL-1.1), and the deps that packages pre-inline into their own bundle (invisible to the module graph): **echarts** (Apache-2.0, incl. its NOTICE per §4d) + **zrender** (BSD-3-Clause) via `@aiden0z/pptx-renderer`, and the Apache-2.0 SheetJS libs `xlsx` inlines (cfb, codepage, crc-32, adler-32, ssf, frac, wmf, word). A comprehensive audit (every runtime dep's declared deps cross-checked against the notices + the shipped dist) confirms nothing embedded is left unattributed. So every third-party work embedded in the onebrain binary is attributed in one file (served at `/THIRD-PARTY-NOTICES.txt`). Supersedes `FONT-NOTICES.txt` (0.1.2) — consolidated here.

## [0.1.2] — 2026-07-01

### Added

- **`FONT-NOTICES.txt` in the build output.** A post-build step (`scripts/gen-notices.mjs`) concatenates the embedded fonts' actual license files (Inter / Chakra Petch / JetBrains Mono — SIL OFL-1.1; KaTeX — MIT) into `dist/FONT-NOTICES.txt`, so the OFL/MIT attribution those licenses require travels with the dist (and the onebrain binary that embeds it; served at `/FONT-NOTICES.txt`). Fails the build if a font's license file is missing. (Font scope only — the bundled JS deps' Apache-2.0/MIT notices are a separate follow-up.)

### Changed

- **Strip redundant legacy font formats.** A CSS-aware post-build step (`scripts/strip-legacy-fonts.mjs`) removes `.woff`/`.ttf` files whose `@font-face` also lists a `.woff2` (modern browsers + the Studio webview fetch woff2 first and never request them) — **−1.48 MB** (89 files). Fonts whose face has no woff2 (KaTeX_Size3, the Vietnamese Chakra/JetBrains subsets) are kept, so nothing breaks. Combined with the CLI's gzip embed, the onebrain binary drops **16.2 MB → ~7.9 MB (−51%)**.

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
