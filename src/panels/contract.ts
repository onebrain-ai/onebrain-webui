// Panel plugin contract — the ONE interface every panel implements (spec D2).
//
// A panel is authored ONCE here and rendered by BOTH shells: the 3D command
// center (projected as a floating glass billboard) and the 2D CMS shell (a flat
// docked pane). A panel never knows which shell hosts it — it only renders its
// UI from `ctx`. Adding a new panel = drop a folder under `panels/`, export a
// `PanelDef`, and add one line to `panels/index.ts`. That is the whole plugin
// surface; no shell code changes.

import type { ComponentType } from "preact";
import type { DaemonClient } from "../core/daemon";

/** Default spatial placement of a panel in the 3D cockpit arc.
 *  World position = (r·sin t, y, −r·cos t); `s` is the billboard scale factor.
 *  The 2D shell ignores everything but ordering. */
export interface PanelPlacement {
  /** angle around the cockpit arc, radians (0 = dead ahead, +right) */
  t: number;
  /** world height */
  y: number;
  /** world radius (distance from the operator) */
  r: number;
  /** billboard scale factor (prototype default 0.005) */
  s: number;
}

/** Everything a panel needs from its host. Shared cross-panel STATE lives in
 *  `core/app-store` signals (imported directly); `ctx` carries only the data
 *  client and the imperative actions that require the shell. */
export interface PanelContext {
  /** The one data interface — live daemon or mock, panels can't tell. */
  daemon: DaemonClient;
  /** Open a vault file in the Preview panel(s) (cross-panel action). */
  openFile(path: string): void;
  /** Spawn a new panel of `type` in front of the camera (composer / ⌘K / add). */
  addPanel(type: string): void;
}

/** A self-contained panel plugin. */
export interface PanelDef {
  /** stable type id, e.g. "explorer" — used in the registry, layout, ⌘K. */
  type: string;
  /** human label, e.g. "File Explorer" — shown in titles, add-menu, ⌘K. */
  name: string;
  /** natural width in px (the prototype's per-type widget width). */
  width: number;
  /** default cockpit-arc placement. */
  placement: PanelPlacement;
  /** part of the 5 panels seeded on a fresh first load. */
  seed?: boolean;
  /** the Preact UI. Receives the host `ctx`; reads shared signals directly. */
  Component: ComponentType<{ ctx: PanelContext }>;
}
