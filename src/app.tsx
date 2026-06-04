// App root — turns the booted daemon handle into a `PanelContext` and renders
// the active shell via `ModeRouter`. Handles the two pre-flight states (no token
// captured, no daemon client) with a clear notice instead of silent 401s.

import type { ComponentChildren } from "preact";
import { daemon as daemonStore, openFile } from "./core/stores";
import { ModeRouter } from "./shells/ModeRouter";
import type { PanelContext, HostEnv, PanelNav } from "./panels/panel";

function detectHostEnv(): HostEnv {
  // Tauri injects `__TAURI__`/`__TAURI_INTERNALS__`; Obsidian's webview exposes
  // a global `app` + `require`. Everything else is a plain browser/PWA.
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI__" in w || "__TAURI_INTERNALS__" in w) return "tauri";
  if ("app" in w && "require" in w) return "obsidian";
  return "browser";
}

export function App({ hasToken }: { hasToken: boolean }) {
  const client = daemonStore.value;

  if (!client) {
    return (
      <Notice title="No daemon">
        <p>No data client was configured at boot.</p>
      </Notice>
    );
  }

  if (!hasToken) {
    return (
      <Notice title="No session token">
        <p>
          Open the URL printed by <code>onebrain serve</code> (it includes a
          <code>?token=…</code>), or load this app from the daemon itself.
        </p>
      </Notice>
    );
  }

  const nav: PanelNav = {
    go: () => {
      /* v1: single CMS layout; panel switching lands with the rail/⌘K. */
    },
    openInPreview: (path: string) => {
      openFile.value = path;
    },
  };

  const ctx: PanelContext = {
    daemon: client,
    nav,
    hostEnv: detectHostEnv(),
    surface: "cms",
  };

  return <ModeRouter ctx={ctx} />;
}

function Notice({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="ob-notice">
      <div class="ob-notice-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
