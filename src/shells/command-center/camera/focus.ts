// Focus / fly-to — double-click (or radar-click) a panel to glide the camera in
// front of it and lock the framing; click the backdrop / Esc to glide back.
// Ported from the prototype (1803–1901). Operates on the shared rig.

import { Vector3, type PerspectiveCamera } from "three";
import { clamp, nearestAngle, clearKeys, PITCH_MIN, PITCH_MAX, type Rig } from "./rig";
import type { WidgetRecord } from "../layout";

export interface FocusDeps {
  rig: Rig;
  camera: PerspectiveCamera;
  /** the live widget array (stable reference). */
  widgets: WidgetRecord[];
  /** current screen focal length (px). */
  focal: () => number;
  toast: (html: string) => void;
}

export interface FocusActions {
  focusWidget(rec: WidgetRecord): void;
  clearFocus(): void;
  cycleFocus(dir: number): void;
  recenterFocus(): void;
  /** carousel order: left→right around the operator. */
  focusOrder(): WidgetRecord[];
}

export function createFocus(deps: FocusDeps): FocusActions {
  const { rig, widgets } = deps;

  const focusOrder = () => [...widgets].sort((a, b) => a.t - b.t || b.world.y - a.world.y);

  function aimAtFocused(dur: number): void {
    const rec = rig.focusedRec;
    if (!rec) return;
    const w = rec.world;
    const dist = 2.7;
    // approach from the side the operator is already on
    const off = new Vector3(rig.pos.x - w.x, 0, rig.pos.z - w.z);
    if (off.lengthSq() < 0.04) off.set(0, 0, 1);
    off.normalize();
    const toPos = new Vector3(w.x + off.x * dist, w.y + 0.12, w.z + off.z * dist);
    const L = w.clone().sub(toPos);
    const toYaw = Math.atan2(-L.x, -L.z);
    const toPitch = clamp(Math.atan2(L.y, Math.hypot(L.x, L.z)), PITCH_MIN, PITCH_MAX);
    rig.focusTween = {
      fromPos: rig.pos.clone(),
      toPos,
      fromYaw: rig.yaw,
      toYaw: nearestAngle(rig.yaw, toYaw),
      fromPitch: rig.pitch,
      toPitch,
      start: performance.now(),
      dur: dur || 720,
    };
  }

  /** the focus-frame scale that makes a panel fill the focus view. */
  function fillScale(rec: WidgetRecord): number {
    const base = (0.005 * deps.focal()) / 2.7;
    const w = rec.el.offsetWidth || 360;
    const h = rec.el.offsetHeight || 300;
    return clamp(Math.min((0.9 * window.innerWidth) / (w * base), (0.84 * window.innerHeight) / (h * base)), 0.6, 4.5);
  }

  function focusWidget(rec: WidgetRecord): void {
    if (rig.exposeActive) return;
    // snap any in-progress drag to rest — a locked focus framing must not keep
    // easing a panel's world underneath it.
    if (rig.dragRec) {
      if (rig.dragRec.wTarget) rig.dragRec.world.copy(rig.dragRec.wTarget);
      rig.dragRec._grab = false;
      rig.dragRec = null;
    }
    if (!rig.focusedRec && !rig.exposeReturn) {
      // remember the view to return to
      rig.focusReturn = {
        pos: rig.pos.clone(),
        yaw: rig.yaw,
        pitch: rig.pitch,
        view: rig.activeViewId,
        pan: widgets.map((r) => r.world.clone()),
      };
    }
    rig.focusedRec = rec;
    rig.focusUiScale = rig.focusUiTarget = 1; // always start at the natural framing
    aimAtFocused(720);
    clearKeys(rig);
    widgets.forEach((w2) => w2.el.classList.toggle("focused", w2 === rec));
    document.body.classList.add("focusmode");
    deps.toast(`Focused · <b>${rec.type.toUpperCase()}</b> — click outside to exit`);
  }

  /** glide the camera + every panel back to a saved {pos,yaw,pitch,pan}. */
  function glideBack(to: { pos: Vector3; yaw: number; pitch: number; pan: Vector3[] }, dur: number): void {
    rig.viewTween = {
      fromPos: rig.pos.clone(),
      toPos: to.pos.clone(),
      fromYaw: rig.yaw,
      toYaw: nearestAngle(rig.yaw, to.yaw),
      fromPitch: rig.pitch,
      toPitch: to.pitch,
      fromPan: widgets.map((r) => r.world.clone()),
      toPan: to.pan.map((v) => v.clone()),
      start: performance.now(),
      dur,
    };
  }

  function clearFocus(): void {
    if (!rig.focusedRec && !rig.focusTween) return;
    rig.focusedRec = null;
    rig.focusTween = null;
    widgets.forEach((w) => w.el.classList.remove("focused"));
    document.body.classList.remove("focusmode", "views-open");
    if (rig.exposeReturn) {
      // drilled in from exposé → glide back to the pre-exposé arrangement
      const ret = rig.exposeReturn;
      rig.exposeReturn = null;
      rig.focusReturn = null;
      glideBack(ret, 620);
      deps.toast("Returned to previous view");
    } else if (rig.focusReturn) {
      // normal focus exit → glide back to the view we came from
      const ret = rig.focusReturn;
      rig.focusReturn = null;
      glideBack(ret, 560);
      rig.activeViewId = ret.view;
    }
  }

  function cycleFocus(dir: number): void {
    const order = focusOrder();
    if (!order.length) return;
    const cur = rig.focusedRec ? order.indexOf(rig.focusedRec) : -1;
    if (cur < 0) {
      // focused panel was removed (or none) → start at the first, don't bias by dir
      focusWidget(order[0]);
      return;
    }
    focusWidget(order[(cur + dir + order.length) % order.length]);
  }

  function recenterFocus(): void {
    if (!rig.focusedRec) return;
    aimAtFocused(520);
    rig.focusUiTarget = fillScale(rig.focusedRec);
    deps.toast("Recentered · fit to view");
  }

  return { focusWidget, clearFocus, cycleFocus, recenterFocus, focusOrder };
}
