// Desk persistence — the open panels (type / key / world position / per-panel
// accent) plus the camera, saved to localStorage so a reload restores the exact
// workspace instead of re-seeding the defaults. Ported from the prototype
// (LAYOUT_KEY / snapshotLayout / flushLayout / restoreLayout 3391-3420). The
// engine owns the snapshot + restore orchestration; this module is just the
// typed read/write/clear over localStorage.

// v3: the default desk changed (Explorer + Preview folded into the combined File
// Browser). Bumping the key makes pre-v3 saved desks fall through to a fresh seed.
const STORE_KEY = "ob-spatial-layout-v3";

export interface SavedPanel {
  type: string;
  key: string;
  x: number;
  y: number;
  z: number;
  /** accent key (e.g. "magenta") or null when inheriting the global accent. */
  accent: string | null;
}

export interface SavedLayout {
  cam: { x: number; y: number; z: number; yaw: number; pitch: number };
  panels: SavedPanel[];
}

/** Read the saved desk, or null if absent / empty / corrupt. */
export function loadLayout(): SavedLayout | null {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (d && Array.isArray(d.panels) && d.panels.length) return d as SavedLayout;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeLayout(json: string): void {
  try {
    localStorage.setItem(STORE_KEY, json);
  } catch {
    /* ignore */
  }
}

export function clearLayout(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
