// Panel plugin contract — the ONE interface every panel implements (spec D2).
//
// A panel is authored ONCE here and rendered by the 2D CMS shell as a flat
// docked pane. A panel only renders its UI from `ctx`. Adding a new panel =
// drop a folder under `panels/`, export a `PanelDef`, and add one line to
// `panels/index.ts`. That is the whole plugin surface; no shell code changes.

import type { ComponentType } from "preact";
import type { DaemonClient } from "../core/daemon";

/** Everything a panel needs from its host. Shared cross-panel STATE lives in
 *  `core/app-store` signals (imported directly); `ctx` carries only the data
 *  client and the imperative actions that require the shell. */
export interface PanelContext {
  /** The one data interface — live daemon or mock, panels can't tell. */
  daemon: DaemonClient;
  /** Open a vault file in the Preview panel(s) (cross-panel action). */
  openFile(path: string): void;
  /** Spawn a new panel of `type` (no-op in the fixed-zone CMS shell). */
  addPanel(type: string): void;
}

/** A self-contained panel plugin. */
export interface PanelDef {
  /** stable type id, e.g. "explorer" — used in the registry and layout. */
  type: string;
  /** human label, e.g. "File Explorer" — shown in titles and the add-menu. */
  name: string;
  /** natural width in px (the prototype's per-type widget width). */
  width: number;
  /** part of the panels seeded on a fresh first load. */
  seed?: boolean;
  /** the Preact UI. Receives the host `ctx`; reads shared signals directly. */
  Component: ComponentType<{ ctx: PanelContext }>;
}
