// Boot. Resolve the session token, build the live daemon client, register the
// first-party panels (side-effect imports), and mount the app.

import { render } from "preact";
import { resolveToken } from "./core/token";
import { HttpDaemonClient } from "./core/daemon";
import { daemon as daemonStore, applyThemeSettings } from "./core/stores";
import { App } from "./app";

// Register first-party panels by importing them for their `registerPanel(...)`
// side effects. Adding a panel = adding an import here (until a bundle/registry
// manifest drives this, per spec §6.2).
import "./panels/explorer";
import "./panels/preview";
import "./panels/settings";

// Design System first (tokens + @font-face), then its component layer, then our
// app-specific layout/overrides. Vendored reference copy — see styles/ds/SOURCE.md.
import "./styles/ds/colors_and_type.css";
import "./styles/ds/components.css";
import "./styles/app.css";

// Apply the persisted accent + density before first paint (no flash).
applyThemeSettings();

const token = resolveToken();

// Same-origin `/api` — the Vite dev proxy (dev) and the daemon-served dist
// (prod) both resolve it. A remote self-host would pass its origin here.
daemonStore.value = new HttpDaemonClient(token);

const root = document.getElementById("app");
if (root) {
  render(<App hasToken={token !== null} />, root);
}
