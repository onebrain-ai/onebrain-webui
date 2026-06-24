// HUD reactive state — the engine writes these each frame / on an interval; the
// Preact HUD chrome reads them. Keeps the canvas-drawn pieces (radar/heading)
// and the DOM chrome (topbar clock/fps, radar caption) in sync.

import { signal } from "@preact/signals";

export const fps = signal(60);
export const clock = signal("--:--:--");
/** objects-in-range count for the radar caption. */
export const radarCount = signal(0);
/** current compass heading (degrees) for the radar caption. */
export const radarHeading = signal(0);
