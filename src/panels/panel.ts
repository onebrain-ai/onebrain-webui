// The one Panel contract both shells consume (spec §6.2, decision D2).
//
// A panel is authored ONCE and rendered by either shell: `CmsShell` mounts its
// container as a flat DOM region; the future `CommandCenterShell` mounts the
// same container as a floating surface in 3D. The panel author never branches on
// shell — only optionally on `ctx.surface` for density tweaks.
//
// `build()` returns real DOM, so it works in both. We bridge Preact components
// to this imperative contract with `mountComponent` (Preact `render` into the
// container; `render(null, …)` on unmount) — see `mount.tsx`.

import type { DaemonClient } from "../core/daemon";

export type HostEnv = "browser" | "obsidian" | "tauri";
export type Surface = "cms" | "command-center";

/** Navigation affordances a panel can call (e.g. Explorer → open a file in
 *  Preview). Kept tiny for v1; grows as more panels land. */
export interface PanelNav {
  /** Focus/activate another panel by its `type`. */
  go(type: string): void;
  /** Open a vault file in the Preview panel. */
  openInPreview(path: string): void;
}

/** Everything a panel needs from the host. Transport/auth details stay inside
 *  `daemon` — a panel never sees a URL or token (decision D3). `theme` (DS
 *  tokens) and `chat` (agent runtime) join this once those land. */
export interface PanelContext {
  daemon: DaemonClient;
  nav: PanelNav;
  hostEnv: HostEnv;
  surface: Surface;
}

/** A live, mounted panel. `recenter` is optional — the 3D shell uses it to
 *  re-frame a focused panel; the CMS shell ignores it. */
export interface PanelInstance {
  unmount(): void;
  recenter?(): void;
}

/** A registrable panel definition. */
export interface PanelDef {
  type: string; // 'explorer' | 'preview' | …
  name: string; // 'File Explorer'
  icon: string; // short rail tag, e.g. 'EX'
  build(container: HTMLElement, ctx: PanelContext): PanelInstance;
}

// ── Panel registry ─────────────────────────────────────────────────────────
// The launcher / rail / (future) ⌘K palette all read from this one registry,
// exactly the drop-in-extension behaviour the prototype sketched.

const registry = new Map<string, PanelDef>();

export function registerPanel(def: PanelDef): void {
  registry.set(def.type, def);
}

export function getPanel(type: string): PanelDef | undefined {
  return registry.get(type);
}

export function listPanels(): PanelDef[] {
  return [...registry.values()];
}
