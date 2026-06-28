# OneBrain WebUI

The **universal surface** for OneBrain — a 2D CMS shell (and, later, a 3D command
center) that runs the OneBrain agent on any platform. The web is the universal
surface; [OneBrain Studio](https://github.com/onebrain-ai) (Tauri) is the
performance enhancement. Goal: an Obsidian replacement, one build everywhere.

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
- One **Panel contract** (`PanelDef.build(container, ctx)`) — panels authored once, ready to also mount in the 3D shell
- Per-session **token** auth (daemon-injected `window.__ONEBRAIN_TOKEN__`, or `?token=` in dev)

Next: the ported Three.js **command center** as a lazy WebGL chunk · [OneBrain Studio](https://github.com/onebrain-ai) (Tauri) for native performance.

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
