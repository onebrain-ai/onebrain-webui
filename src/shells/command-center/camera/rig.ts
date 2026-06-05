// Camera rig — the shared mutable camera + interaction state that the input
// listeners, the focus/view/exposé actions, the per-widget drag/resize, and the
// engine render loop all read and mutate. The prototype keeps these as module
// globals; we hold them in one object so the engine owns the lifecycle.
//
// This file also carries the pure per-frame STEP functions (movement, focus &
// view tweens, the dragged-panel ease) — they only need the rig, the camera and
// the widget list.

import { Vector3, type PerspectiveCamera } from "three";
import type { WidgetRecord } from "../layout";

export const MOVE_SPEED = 0.24; // world units / frame (×2 sprint)
export const ROT_SPEED = 0.044; // peak eased keyboard-turn rate (rad/frame)
export const PITCH_MAX = 0.34;
export const PITCH_MIN = -1.05;
export const LOOK_SENS = 0.0024;
export const PANEL_MIN_Y = -2.6; // panels rest on the grid plane (y=-3), never below

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** easeInOutCubic — the one easing used by every fly-to / view tween. */
export const easeInOutCubic = (e: number) => (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2);
/** shortest signed angle from `from` to `to` (handles wrap). */
export const nearestAngle = (from: number, to: number) => {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d;
};

export interface Tween {
  fromPos: Vector3;
  toPos: Vector3;
  fromYaw: number;
  toYaw: number;
  fromPitch: number;
  toPitch: number;
  /** per-widget world positions to lerp (view / exposé tweens). */
  fromPan?: Vector3[];
  toPan?: Vector3[];
  start: number;
  dur: number;
}

export interface ViewReturn {
  pos: Vector3;
  yaw: number;
  pitch: number;
  view: number | null;
  pan: Vector3[];
}
export interface ExposeSaved {
  pos: Vector3;
  yaw: number;
  pitch: number;
  pan: Vector3[];
}

export interface Rig {
  // ── camera state ──
  pos: Vector3;
  yaw: number;
  pitch: number;
  // ── movement ──
  keys: { fwd: boolean; back: boolean; left: boolean; right: boolean; rotL: boolean; rotR: boolean; sprint: boolean };
  moveVel: Vector3;
  yawVel: number;
  dolly: number;
  // ── interaction state ──
  focusedRec: WidgetRecord | null;
  focusTween: Tween | null;
  viewTween: Tween | null;
  exposeActive: boolean;
  dof: number;
  focusUiScale: number;
  focusUiTarget: number;
  focusDist: number;
  activeViewId: number | null;
  focusReturn: ViewReturn | null;
  exposeSaved: ExposeSaved | null;
  exposeReturn: ExposeSaved | null;
  dragRec: WidgetRecord | null;
}

export function createRig(): Rig {
  return {
    pos: new Vector3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    keys: { fwd: false, back: false, left: false, right: false, rotL: false, rotR: false, sprint: false },
    moveVel: new Vector3(),
    yawVel: 0,
    dolly: 0,
    focusedRec: null,
    focusTween: null,
    viewTween: null,
    exposeActive: false,
    dof: 0,
    focusUiScale: 1,
    focusUiTarget: 1,
    focusDist: 6,
    activeViewId: null,
    focusReturn: null,
    exposeSaved: null,
    exposeReturn: null,
    dragRec: null,
  };
}

/** Drop every held movement key (called when entering focus / view / exposé). */
export function clearKeys(rig: Rig): void {
  const k = rig.keys;
  k.fwd = k.back = k.left = k.right = k.rotL = k.rotR = k.sprint = false;
}

/** Begin a drag/resize gesture on `rec` — snaps any prior dragged panel to rest
 *  first, then seeds rec.wTarget from its current world. */
export function beginDrag(rig: Rig, rec: WidgetRecord): void {
  if (rig.dragRec && rig.dragRec !== rec && rig.dragRec.wTarget) {
    rig.dragRec.world.copy(rig.dragRec.wTarget);
    rig.dragRec._grab = false;
  }
  rec.wTarget = (rec.wTarget ?? new Vector3()).copy(rec.world);
  rec._grab = true;
  rig.dragRec = rec;
}

/** Release a gesture — the loop eases the panel to rest, then frees dragRec. */
export function releaseDrag(rec: WidgetRecord): void {
  rec._grab = false;
}

/** Snap any in-progress drag to its target and free it — call before a camera
 *  tween (focus / view / exposé) takes over, so the panel is included in the
 *  tween instead of being skipped by stepView and left stranded. */
export function settleDrag(rig: Rig): void {
  if (!rig.dragRec) return;
  if (rig.dragRec.wTarget) rig.dragRec.world.copy(rig.dragRec.wTarget);
  rig.dragRec._grab = false;
  rig.dragRec = null;
}

const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3();
const _right = new Vector3();
const _want = new Vector3();
const forwardVec = (yaw: number) => _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));

/** Eased first-person movement. Locked (decays to rest) while focused / flying /
 *  in exposé. Ported from the prototype updateMovement (1701–1726). */
export function updateMovement(rig: Rig): void {
  if (rig.focusedRec || rig.focusTween || rig.viewTween || rig.exposeActive) {
    rig.moveVel.multiplyScalar(0.82);
    rig.yawVel *= 0.82;
    rig.dolly *= 0.82;
    return;
  }
  const fwd = forwardVec(rig.yaw);
  _right.crossVectors(fwd, _up).normalize();
  _want.set(0, 0, 0);
  if (rig.keys.fwd) _want.add(fwd);
  if (rig.keys.back) _want.addScaledVector(fwd, -1);
  if (rig.keys.right) _want.add(_right);
  if (rig.keys.left) _want.addScaledVector(_right, -1);
  const moving = _want.lengthSq() > 0;
  const targetSpeed = MOVE_SPEED * (rig.keys.sprint ? 2.0 : 1);
  if (moving) {
    _want.y = 0;
    _want.normalize().multiplyScalar(targetSpeed);
  }
  rig.moveVel.lerp(_want, moving ? 0.16 : 0.1);
  if (rig.moveVel.lengthSq() < 1e-7) rig.moveVel.set(0, 0, 0);
  rig.pos.add(rig.moveVel);
  if (rig.dolly) {
    const step = rig.dolly * 0.16;
    rig.pos.addScaledVector(forwardVec(rig.yaw), step);
    rig.dolly -= step;
    if (Math.abs(rig.dolly) < 1e-4) rig.dolly = 0;
  }
  const turn = (rig.keys.rotL ? 1 : 0) - (rig.keys.rotR ? 1 : 0);
  rig.yawVel += (turn * ROT_SPEED - rig.yawVel) * (turn ? 0.16 : 0.1);
  if (Math.abs(rig.yawVel) < 1e-5) rig.yawVel = 0;
  if (rig.yawVel) {
    rig.yaw += rig.yawVel;
    rig.activeViewId = null; // a manual keyboard turn ends a recalled bookmark
  }
  rig.pos.y += (0 - rig.pos.y) * 0.08;
  if (Math.abs(rig.pos.y) < 1e-4) rig.pos.y = 0;
}

/** Advance the focus fly-to tween (easeInOutCubic). */
export function stepFocus(rig: Rig): void {
  const tw = rig.focusTween;
  if (!tw) return;
  const k = easeInOutCubic(clamp((performance.now() - tw.start) / tw.dur, 0, 1));
  rig.pos.lerpVectors(tw.fromPos, tw.toPos, k);
  rig.yaw = tw.fromYaw + (tw.toYaw - tw.fromYaw) * k;
  rig.pitch = tw.fromPitch + (tw.toPitch - tw.fromPitch) * k;
  if (k >= 1) rig.focusTween = null;
}

/** Advance a view/exposé tween — lerps the camera AND every widget world. */
export function stepView(rig: Rig, widgets: WidgetRecord[]): void {
  const tw = rig.viewTween;
  if (!tw) return;
  const k = easeInOutCubic(clamp((performance.now() - tw.start) / tw.dur, 0, 1));
  rig.pos.lerpVectors(tw.fromPos, tw.toPos, k);
  rig.yaw = tw.fromYaw + (tw.toYaw - tw.fromYaw) * k;
  rig.pitch = tw.fromPitch + (tw.toPitch - tw.fromPitch) * k;
  if (tw.fromPan && tw.toPan) {
    widgets.forEach((r, i) => {
      if (r === rig.dragRec) return; // a panel under an active gesture owns its own world
      r.world.lerpVectors(tw.fromPan![i], tw.toPan![i], k);
    });
  }
  if (k >= 1) rig.viewTween = null;
}

/** Ease a dragged / free-resized panel toward its target so it settles. */
export function advanceDrag(rig: Rig): void {
  const rec = rig.dragRec;
  if (!rec || !rec.wTarget) return;
  rec.world.lerp(rec.wTarget, 0.22);
  if (!rec._grab && rec.world.distanceTo(rec.wTarget) < 0.003) {
    rec.world.copy(rec.wTarget);
    rig.dragRec = null;
  }
}

/** Recompute the focus-plane distance + ease dof / focusUiScale each frame. */
export function easeFocusDof(rig: Rig, camera: PerspectiveCamera): void {
  rig.dof += ((rig.focusedRec ? 1 : 0) - rig.dof) * 0.12;
  if (rig.dof < 0.002) rig.dof = 0;
  rig.focusUiScale += (rig.focusUiTarget - rig.focusUiScale) * 0.2;
  void camera;
}
