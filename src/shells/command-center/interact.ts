// Per-widget interaction — header-drag to relocate (view-plane move, shift =
// depth), corner-grip resize (slide along the camera→panel ray, or scale the
// frame when focused), and double-click to focus. Ported from the prototype
// (makeWidgetInteractive 1730–1799, attachResize 1984–2027).

import { Vector3, MathUtils, type PerspectiveCamera } from "three";
import { beginDrag, releaseDrag, clamp, PANEL_MIN_Y, type Rig } from "./camera/rig";
import type { FocusActions } from "./camera/focus";
import type { WidgetRecord } from "./layout";

const NONDRAG =
  "input,textarea,button,a,.acc-pop,.skill-scroll,.log-feed,.slash-menu,.task-row,.skill-row,.slash-item,.composer,.w-handle,.fx-tree,.fx-row,.fx-hit,.fx-tools,.pv-body,.chat-feed,.chat-input,.cli-out,.cli-line,.qs-box,.qs-results,.qs-hit";

export interface InteractDeps {
  rig: Rig;
  camera: PerspectiveCamera;
  focus: FocusActions;
  /** drill into a tile from exposé (M5b). */
  focusFromExpose?: (rec: WidgetRecord) => void;
}

const grab = () => {
  try {
    window.focus();
    (document.getElementById("look") as HTMLElement | null)?.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
};

/** Wire a panel for header-drag / corner-resize / double-click-focus. The
 *  listeners live on the panel element, so they're dropped when the engine
 *  removes it. */
export function makeWidgetInteractive(rec: WidgetRecord, deps: InteractDeps): void {
  const { rig, camera, focus } = deps;
  const el = rec.el;
  let start: { x: number; y: number } | null = null;
  let mode: "maybe" | "drag" | "nodrag" | "expose-tap" | null = null;
  let lx = 0;
  let ly = 0;
  let dragOK = false;

  el.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(NONDRAG)) return; // inner controls behave normally
    if (e.button !== 0) return; // primary only
    e.stopPropagation();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* panel may be disposed mid-gesture */
    }
    start = { x: e.clientX, y: e.clientY };
    lx = e.clientX;
    ly = e.clientY;
    if (rig.exposeActive) {
      mode = "expose-tap";
      dragOK = false;
      grab();
      return;
    }
    dragOK = !rig.focusedRec && !!(e.target as HTMLElement).closest(".w-head"); // ONLY the header relocates
    mode = "maybe";
    grab();
  });

  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (!(e.buttons & 1)) {
      el.classList.remove("dragging", "depth");
      if (mode === "drag") releaseDrag(rec);
      start = null;
      mode = null;
      dragOK = false;
      return;
    }
    const sdx = e.clientX - start.x;
    const sdy = e.clientY - start.y;
    if (mode === "maybe" && Math.hypot(sdx, sdy) > 5) {
      if (dragOK) {
        mode = "drag";
        el.classList.add("dragging");
        beginDrag(rig, rec);
      } else {
        mode = "nodrag";
      }
    }
    if (mode === "drag" && rec.wTarget) {
      if (e.shiftKey) {
        // depth drag — slide along the camera→panel ray (down = closer, up = away)
        el.classList.add("depth");
        const ray = new Vector3().subVectors(rec.wTarget, camera.position);
        let dist = ray.length();
        if (dist < 1e-3) {
          ray.set(0, 0, -1);
          dist = 1e-3;
        }
        ray.normalize();
        dist = clamp(dist - (e.clientY - ly) * dist * 0.01, 1.6, 38);
        rec.wTarget.copy(camera.position).addScaledVector(ray, dist);
      } else {
        el.classList.remove("depth");
        const fwd = new Vector3();
        camera.getWorldDirection(fwd);
        const right = new Vector3().crossVectors(fwd, camera.up).normalize();
        const up = new Vector3().crossVectors(right, fwd).normalize();
        const distance = camera.position.distanceTo(rec.wTarget);
        const wpp = (2 * distance * Math.tan(MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
        rec.wTarget.addScaledVector(right, (e.clientX - lx) * wpp).addScaledVector(up, -(e.clientY - ly) * wpp);
      }
      if (rec.wTarget.y < PANEL_MIN_Y) rec.wTarget.y = PANEL_MIN_Y;
      lx = e.clientX;
      ly = e.clientY;
    }
  });

  const finish = (e: PointerEvent) => {
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    el.classList.remove("dragging", "depth");
    if (mode === "expose-tap" && moved < 6) deps.focusFromExpose?.(rec);
    if (mode === "drag") releaseDrag(rec);
    start = null;
    mode = null;
    dragOK = false;
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(NONDRAG)) return;
    if (rig.exposeActive || rig.focusedRec) return;
    e.stopPropagation();
    focus.focusWidget(rec);
  });

  // four corner grips → drag to resize
  for (const corner of ["tl", "tr", "bl", "br"] as const) {
    const h = document.createElement("div");
    h.className = `w-handle ${corner}`;
    h.setAttribute("aria-hidden", "true");
    el.appendChild(h);
    attachResize(rec, h, corner, deps);
  }
}

function attachResize(rec: WidgetRecord, h: HTMLElement, corner: string, deps: InteractDeps): void {
  const { rig, camera } = deps;
  const sx = corner.includes("l") ? -1 : 1;
  const sy = corner.includes("t") ? -1 : 1;
  const INV = 0.70710678; // 1/√2
  let on = false;
  let lx = 0;
  let ly = 0;

  h.addEventListener("pointerdown", (e) => {
    if (rig.exposeActive) return;
    if (rig.focusedRec && rig.focusedRec !== rec) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    try {
      h.setPointerCapture(e.pointerId);
    } catch {
      /* panel may be disposed mid-gesture */
    }
    on = true;
    lx = e.clientX;
    ly = e.clientY;
    if (rig.focusedRec !== rec) beginDrag(rig, rec);
    h.classList.add("resizing");
    rec.el.classList.add("dragging");
    grab();
  });
  h.addEventListener("pointermove", (e) => {
    if (!on) return;
    if (!(e.buttons & 1)) {
      end();
      return;
    }
    const g = ((e.clientX - lx) * sx + (e.clientY - ly) * sy) * INV; // + = dragged outward (grow)
    if (rig.focusedRec === rec) {
      rig.focusUiTarget = clamp(rig.focusUiTarget * (1 + g * 0.012), 0.45, 4.5);
    } else if (rec.wTarget) {
      const ray = new Vector3().subVectors(rec.wTarget, camera.position);
      let dist = ray.length();
      if (dist < 1e-3) {
        ray.set(0, 0, -1);
        dist = 1e-3;
      }
      ray.normalize();
      dist = clamp(dist - g * dist * 0.012, 1.6, 38);
      rec.wTarget.copy(camera.position).addScaledVector(ray, dist);
      if (rec.wTarget.y < PANEL_MIN_Y) rec.wTarget.y = PANEL_MIN_Y;
    }
    lx = e.clientX;
    ly = e.clientY;
  });
  const end = () => {
    if (!on) return;
    on = false;
    h.classList.remove("resizing");
    rec.el.classList.remove("dragging");
    if (rig.focusedRec !== rec) releaseDrag(rec);
  };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
}
