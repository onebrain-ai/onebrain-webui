// Frame-rate cap store — the Settings segmented selector (30 / 60 / 120 / 144).
// The engine reads frameMs() each frame to throttle the render loop; the choice
// persists. Ported from the prototype (FPS_CHOICES / setFpsCap 2092–2107).

import { signal } from "@preact/signals";

export const FPS_CHOICES = [30, 60, 120, 144];
const STORE_KEY = "ob-fps-cap";

function initialCap(): number {
  try {
    const v = Number(localStorage.getItem(STORE_KEY));
    if (FPS_CHOICES.includes(v)) return v;
  } catch {
    /* sandboxed storage */
  }
  return 60;
}

/** the active FPS cap. Settings segment buttons subscribe to this. */
export const fpsCap = signal<number>(initialCap());

/** target ms-per-frame for the render-loop throttle (read each frame). */
export function frameMs(): number {
  return 1000 / fpsCap.peek();
}

export function setFpsCap(v: number): void {
  if (!FPS_CHOICES.includes(v)) v = 60;
  fpsCap.value = v;
  try {
    localStorage.setItem(STORE_KEY, String(v));
  } catch {
    /* ignore */
  }
}
