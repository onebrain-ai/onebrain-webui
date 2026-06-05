// Billboard projection — the widgets are flat HTML panels, NOT CSS3DObjects.
// Each frame we project each panel's world position to screen space and write a
// `translate(...) scale(...)` transform, so they read as floating in the 3D field
// through perspective scale, distance glass, opacity and z-ordering — while
// staying square, head-on, readable rectangles. Ported from the prototype's
// layoutWidgets (lines 1524–1556); focus/DOF branches arrive in M3.

import { Vector3, type PerspectiveCamera } from "three";

export interface WidgetRecord {
  type: string;
  /** short blip label for the radar (e.g. "EXP"). */
  label: string;
  /** world-space anchor of the panel. */
  world: Vector3;
  /** billboard scale factor (PanelPlacement.s — prototype default 0.005). */
  s: number;
  /** the `.widget` DOM element projected each frame. */
  el: HTMLElement;
  /** last pushed --glass value (throttles the backdrop-filter paint). */
  _glass?: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const _pv = new Vector3();
const _ndc = new Vector3();

/** Project every widget to screen space. Call after the scene render so the
 *  camera matrices are current. `focal` = (innerHeight/2)/tan(fov/2). */
export function projectWidgets(widgets: Iterable<WidgetRecord>, camera: PerspectiveCamera, focal: number): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
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
    const s = (rec.s * focal) / d; // closer = bigger
    rec.el.style.transform = `translate(${sx - rec.el.offsetWidth / 2}px,${sy - rec.el.offsetHeight / 2}px) scale(${s})`;
    // distance glass: near (d≤5) frosted & see-through → far (d≥17) opaque solid.
    // Throttle the write — backdrop-filter is a paint hot path.
    const glass = clamp((17 - d) / 12, 0, 1);
    if (rec._glass === undefined || Math.abs(glass - rec._glass) > 0.03) {
      rec.el.style.setProperty("--glass", glass.toFixed(3));
      rec._glass = glass;
    }
    // gentle far-fade with a high floor — distant panels stay visible (markers)
    rec.el.style.opacity = String(clamp(1.18 - d / 60, 0.6, 1));
    rec.el.style.zIndex = String(Math.max(0, Math.round(20000 - d * 200)));
  }
}
