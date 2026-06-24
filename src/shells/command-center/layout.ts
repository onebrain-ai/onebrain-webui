// Billboard projection — the widgets are flat HTML panels, NOT CSS3DObjects.
// Each frame we project each panel's world position to screen space and write a
// `translate(...) scale(...)` transform, so they read as floating in the 3D field
// through perspective scale, distance glass, opacity and z-ordering — while
// staying square, head-on, readable rectangles. Ported from the prototype's
// layoutWidgets (lines 1524–1556); focus/DOF branches arrive in M3.

import { Vector3, type PerspectiveCamera } from "three";
import type { Rig } from "./camera/rig";

export interface WidgetRecord {
  type: string;
  /** unique instance key (= type for the single seed instances). */
  key: string;
  /** short blip label for the radar (e.g. "EXP"). */
  label: string;
  /** cockpit-arc angle (placement.t) — orders the focus carousel + exposé. */
  t: number;
  /** world-space anchor of the panel. */
  world: Vector3;
  /** eased drag/resize target (the panel lerps `world` → `wTarget`). */
  wTarget?: Vector3;
  /** true while a gesture actively holds this panel. */
  _grab?: boolean;
  /** billboard scale factor (PanelPlacement.s — prototype default 0.005). */
  s: number;
  /** the `.widget` DOM element projected each frame. */
  el: HTMLElement;
  /** last pushed --glass value (throttles the backdrop-filter paint). */
  _glass?: number;
  /** per-panel accent KEY (e.g. "magenta"), or null/undefined → global accent.
   *  Drives the inline --section-accent override + the radar blip + shadow tint. */
  accent?: string | null;
  /** the per-panel accent popover element (header swatch picker). */
  accPop?: HTMLElement;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const _pv = new Vector3();
const _ndc = new Vector3();

/** Project every widget to screen space. Call after the scene render so the
 *  camera matrices are current. `focal` = (innerHeight/2)/tan(fov/2). The `rig`
 *  carries focus state (the focused panel scales up + stays crisp; the rest
 *  blur/dim with depth-of-field). */
export function projectWidgets(widgets: WidgetRecord[], camera: PerspectiveCamera, focal: number, rig: Rig): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  // depth-of-field plane = the focused panel's distance
  let fd = rig.focusDist;
  if (rig.focusedRec) {
    _pv.copy(rig.focusedRec.world).applyMatrix4(camera.matrixWorldInverse);
    fd = -_pv.z;
    rig.focusDist = fd;
  }
  for (const rec of widgets) {
    _pv.copy(rec.world).applyMatrix4(camera.matrixWorldInverse);
    const d = -_pv.z; // distance in front of the camera
    if (d < 0.4) {
      rec.el.style.visibility = "hidden";
      continue;
    }
    rec.el.style.visibility = "visible";
    _ndc.copy(rec.world).project(camera);
    const sx = (_ndc.x * 0.5 + 0.5) * W;
    const sy = (-_ndc.y * 0.5 + 0.5) * H;
    const isFoc = rec === rig.focusedRec;
    const s = ((rec.s * focal) / d) * (isFoc ? rig.focusUiScale : 1); // closer = bigger; focus scales the framed panel
    rec.el.style.transform = `translate(${sx - rec.el.offsetWidth / 2}px,${sy - rec.el.offsetHeight / 2}px) scale(${s})`;
    // panels off the focused plane blur + dim so depth reads as real distance
    const blur = isFoc ? 0 : clamp(Math.abs(d - fd) * 2.4, 0, 11) * rig.dof;
    rec.el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
    // distance glass: near (d≤5) frosted & see-through → far (d≥17) opaque solid.
    const glass = clamp((17 - d) / 12, 0, 1);
    if (rec._glass === undefined || Math.abs(glass - rec._glass) > 0.03) {
      rec.el.style.setProperty("--glass", glass.toFixed(3));
      rec._glass = glass;
    }
    const dim = isFoc ? 1 : 1 - 0.5 * rig.dof;
    rec.el.style.opacity = String(clamp((1.18 - d / 60) * dim, 0.6, 1));
    rec.el.style.zIndex = String(Math.max(0, Math.round(20000 - d * 200)));
  }
}
