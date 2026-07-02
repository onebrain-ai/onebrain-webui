<!-- Banner pinned to a commit SHA on onebrain-ai/onebrain (not the mutable
     `main` branch) so a future asset restructure can't silently 404 this
     image. Bump the SHA when refreshing the brand assets. -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/onebrain-ai/onebrain/c391f40e1881e4a07586a564efd1db40d3920b26/assets/header-dark.png">
    <img alt="OneBrain — Your AI Thinking Partner" src="https://raw.githubusercontent.com/onebrain-ai/onebrain/c391f40e1881e4a07586a564efd1db40d3920b26/assets/header-light.png" width="640">
  </picture>
</p>

<p align="center"><em>Your AI Thinking Partner</em></p>

<p align="center">
  <strong>The web app for OneBrain — your whole vault, agent chat, and rich previews in the browser.</strong><br>
  <sub>No Obsidian required · Preact + Vite · talks to the <code>onebrain serve</code> daemon · one build, every platform.</sub>
</p>

<p align="center">
  <a href="https://onebrain.run"><img alt="Website" src="https://img.shields.io/badge/onebrain.run-0a0a14?style=for-the-badge&labelColor=ff2d92"></a>
  <a href="https://x.com/onebrain_run"><img alt="@onebrain_run on X" src="https://img.shields.io/badge/follow-@onebrain__run-000000?style=for-the-badge&logo=x&logoColor=white"></a>
  <a href="https://github.com/onebrain-ai/onebrain-webui/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/onebrain-ai/onebrain-webui?style=for-the-badge&color=00f3ff&logo=github"></a>
</p>
<p align="center">
  <a href="https://github.com/onebrain-ai/onebrain-webui/releases/latest"><img alt="webui release" src="https://img.shields.io/github/v/release/onebrain-ai/onebrain-webui?display_name=tag&style=for-the-badge&logo=github&color=ff2d92&label=webui"></a>
  <a href="https://github.com/onebrain-ai/onebrain-cli/releases/latest"><img alt="onebrain daemon" src="https://img.shields.io/github/v/release/onebrain-ai/onebrain-cli?include_prereleases&style=for-the-badge&logo=rust&color=cb3837&label=onebrain%20daemon"></a>
  <a href="https://preactjs.com"><img alt="Built with Preact + Vite" src="https://img.shields.io/badge/Preact%20%2B%20Vite-bc13fe?style=for-the-badge&logo=preact&logoColor=white"></a>
  <a href="LICENSE-MIT"><img alt="License: MIT OR Apache-2.0" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-7c3aed?style=for-the-badge"></a>
</p>

---

# OneBrain WebUI

The **web app for OneBrain**, built for everyday ease of use: open a browser
and your whole vault is there — notes, live agent chat, search, tasks, and
rich previews — on any platform, one build everywhere.

It **replaces and enhances Obsidian**: you don't need Obsidian installed to
use OneBrain at full function. Everything the vault workflow needs lives
here — reading and editing notes, wikilinks, an in-app webview for external
links, PDF/Office/diagram previews, and the agent itself.

Built with **Preact + @preact/signals + Vite + TypeScript**. Talks to the
**`onebrain` daemon** (`onebrain serve`) over a small JSON
API — transport-agnostic, so the same build runs against a local or a remote
daemon.

## Status

🟢 **Shipped — embedded in the `onebrain` CLI (v3.3.10+).** A release `onebrain` bundles this build and `onebrain serve` mounts it at `/`. Working today:

- `CmsShell` — rail · Explorer · reading view · chat dock with **live agent chat** (streamed over `POST /api/chat`)
- **Reading view** — markdown (callouts, mermaid, KaTeX, footnotes) · syntax-highlighted code with a line-number gutter · rich previews for PDF, Office docs (docx/pptx/xlsx), images, audio/video, Jupyter notebooks, CSV, SVG, draw.io
- **Editor** — CodeMirror 6 live-preview editor + the `PUT` write path
- **qmd search panel** — two-tier: keyword (BM25) live, then keyword + semantic (vector) once the qmd index is available; falls back to filename/path search otherwise
- `HttpDaemonClient` over the vault JSON API (`/api/config`, `/api/vault/tree|file|raw|search`, `/api/chat`, …)
- One **Panel contract** (`PanelDef.build(container, ctx)`) — panels authored once against a single surface-agnostic contract
- Per-session **token** auth (daemon-injected `window.__ONEBRAIN_TOKEN__`, or `?token=` in dev)


## Develop

Requires a running daemon ([`onebrain-cli`](https://github.com/onebrain-ai/onebrain-cli) v3.3+ — `brew install onebrain-ai/onebrain/onebrain`):

```sh
# 1. start the daemon's HTTP surface against your real vault
cd /path/to/your/vault
onebrain serve            # prints http://127.0.0.1:6789/?token=<TOKEN>

# 2. start the WebUI dev server (proxies /api → 127.0.0.1:6789)
npm install
npm run dev               # http://localhost:5173

# 3. open the dev server WITH the token from step 1:
#    http://localhost:5173/?token=<TOKEN>
```

Point at a non-default daemon: `ONEBRAIN_DAEMON=http://host:port npm run dev`.

## Build

```sh
npm run build             # tsc --noEmit + vite build → dist/
```

End users don't build anything: a release `onebrain` **embeds this UI** and `onebrain serve` (no `--dir`) mounts it — the CLI release pipeline rebuilds + embeds the latest `main` on every tag, so the shipped UI always matches the release.

For local development against a live daemon, serve a fresh build directly with `onebrain serve --dir dist` (it injects the token into `index.html`, so no `?token=` is needed).

## License

`MIT OR Apache-2.0` (permissive, dual) — part of OneBrain's open core. See
[`LICENSE-MIT`](LICENSE-MIT) and [`LICENSE-APACHE`](LICENSE-APACHE) in the repo
root; `package.json` declares the same dual license. Use this project under
either license, at your option.
