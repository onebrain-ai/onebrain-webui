# OneBrain WebUI

The **universal surface** for OneBrain — a 2D CMS shell (and, later, a 3D command
center) that runs the OneBrain agent on any platform. The web is the universal
surface; [OneBrain Studio](https://github.com/onebrain-ai) (Tauri) is the
performance enhancement. Goal: an Obsidian replacement, one build everywhere.

Built with **Preact + @preact/signals + Vite + TypeScript**. Talks to the
**`onebrain` daemon** (`onebrain serve` / `onebrain daemon`) over a small JSON
API — transport-agnostic, so the same build runs against a local or a remote
daemon.

## Status

🟡 **v0.1 scaffold (step 3 / CmsShell).** Working today:

- `CmsShell` — rail · Explorer · Preview · chat dock (chat is a stub until the
  agent runtime lands)
- `HttpDaemonClient` over `GET /api/config`, `/api/vault/tree`, `/api/vault/file`
- One **Panel contract** (`PanelDef.build(container, ctx)`) — Explorer + Preview
  authored once, ready to also mount in the 3D shell
- Per-session **token** auth (daemon-injected `window.__ONEBRAIN_TOKEN__`, or
  `?token=` in dev)

Next: live-preview markdown editor (CodeMirror 6) · `PUT` write path · qmd search
panel · the ported Three.js **command center** as a lazy WebGL chunk.

## Develop

Requires a running daemon (from `onebrain-cli`, branch `v3.3-daemon` or later):

```sh
# 1. start the daemon's HTTP surface against your real vault
cd /path/to/your/vault
onebrain serve            # prints http://127.0.0.1:4317/?token=<TOKEN>

# 2. start the WebUI dev server (proxies /api → 127.0.0.1:4317)
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

The daemon serves the built `dist/` directly: `onebrain serve --dir dist` (it
injects the token into `index.html`, so no `?token=` is needed in production).

## License

`MIT OR Apache-2.0` (permissive, dual) — part of OneBrain's open core. The
`LICENSE-MIT` / `LICENSE-APACHE` files are added as part of the org-wide
relicense (see the OneBrain strategy note); `package.json` already declares the
dual license.
