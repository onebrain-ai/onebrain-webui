// Boot / warp / toast / first-run state + the leave-boot orchestration. Ported
// from the prototype (leaveBoot 3078–3090, toast 3155–3157, maybeFirstRun
// 3091–3100). The overlays are Preact components that react to these signals.

import { signal } from "@preact/signals";
import { reduceMotion } from "../../../core/motion";

/** true once the boot screen has been dismissed (Enter pressed). */
export const bootGone = signal(false);
/** Direct handle to the #warp element. The shutter transition is driven by
 *  synchronous classList mutations (not a signal) so the height-0 baseline frame
 *  is painted before "closing" is added — a signal write batches both into one
 *  paint and the transition would jump instead of animate. */
export const warpRef: { current: HTMLElement | null } = { current: null };
export const toastHtml = signal("");
export const toastShow = signal(false);
export const firstRunShow = signal(false);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Flash a transient toast (trusted HTML — caller-controlled strings only). */
export function toast(html: string): void {
  toastHtml.value = html;
  toastShow.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastShow.value = false), 2600);
}

const FR_KEY = "ob-firstrun-seen";
function maybeFirstRun(delay: number): void {
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(FR_KEY);
  } catch {
    /* ignore */
  }
  if (seen) return;
  setTimeout(() => (firstRunShow.value = true), delay);
}
export function dismissFirstRun(): void {
  firstRunShow.value = false;
  try {
    localStorage.setItem(FR_KEY, "1");
  } catch {
    /* ignore */
  }
  grabKeyboard();
}

/** Pull keyboard focus onto the look surface so WASD lands after entering. */
function grabKeyboard(): void {
  try {
    window.focus();
    (document.getElementById("look") as HTMLElement | null)?.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

const ENTER_TOAST = "Use <b>W/S</b> to move · <b>A/D</b> to turn · double-click a panel to focus";

/** Enter → a scanline shutter closes from top+bottom to a center line, holds,
 *  then opens outward into the field. Reduced-motion skips the warp. */
export function leaveBoot(): void {
  if (bootGone.value) return;
  if (reduceMotion) {
    bootGone.value = true;
    setTimeout(grabKeyboard, 60);
    toast(ENTER_TOAST);
    maybeFirstRun(900);
    return;
  }
  bootGone.value = true;
  const el = warpRef.current;
  if (el) {
    el.classList.add("run"); // bands present at height 0…
    requestAnimationFrame(() => el.classList.add("closing")); // …then collapse to the center line
    setTimeout(() => {
      el.classList.remove("closing");
      el.classList.add("opening"); // open outward (warp in)
      grabKeyboard();
      setTimeout(() => el.classList.remove("run", "opening"), 720);
    }, 780);
  } else {
    grabKeyboard();
  }
  toast(ENTER_TOAST);
  maybeFirstRun(1700);
}
