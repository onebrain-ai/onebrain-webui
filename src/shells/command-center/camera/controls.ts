// First-person controls — drag-look (pointer on the #look surface) + WASD/QE
// movement + wheel dolly, all eased. Ported from the prototype (lines 1588–1726).
//
// Navigation model:
//   drag on the look surface → yaw / pitch
//   W/S  → walk forward / back on the plane
//   A/D / arrows → turn the camera (yaw)
//   Q/E  → strafe left / right
//   Shift → sprint (2×)
//   wheel → dolly forward / back
// The operator is locked to the walking plane (y eases back to 0). Focus / view /
// exposé branches are added in M3; this is the free-roam core.

import { Vector3 } from "three";

const LOOK_SENS = 0.0024; // radians / pixel
const PITCH_MAX = 0.34; // look up capped (~19.5°)
const PITCH_MIN = -1.05; // look down stays open to read the floor
const ROT_SPEED = 0.044; // peak eased keyboard-turn rate (rad/frame)
const MOVE_SPEED = 0.24; // world units / frame (×2 sprint)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// per-frame scratch vectors — reused so update() allocates nothing on the hot path
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3();
const _right = new Vector3();
const _want = new Vector3();

export interface Controls {
  /** operator position on the walking plane (engine copies → camera each frame). */
  readonly pos: Vector3;
  yaw(): number;
  pitch(): number;
  /** integrate one frame of eased movement. */
  update(): void;
  dispose(): void;
}

export function attachControls(surface: HTMLElement): Controls {
  const pos = new Vector3(0, 0, 0);
  let yaw = 0;
  let pitch = 0;
  let yawVel = 0; // eased keyboard turn velocity
  let dolly = 0; // eased wheel-dolly budget
  const moveVel = new Vector3(); // smoothed walk velocity
  const keys = { fwd: false, back: false, left: false, right: false, rotL: false, rotR: false, sprint: false };

  // ── drag-look ──────────────────────────────────────────────────────────────
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // primary only — right/middle never start a look-drag
    lastX = e.clientX;
    lastY = e.clientY;
    surface.setPointerCapture(e.pointerId);
    dragging = true;
    surface.classList.add("drag");
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    if (!(e.buttons & 1)) {
      dragging = false;
      surface.classList.remove("drag");
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw -= dx * LOOK_SENS;
    pitch = clamp(pitch - dy * LOOK_SENS, PITCH_MIN, PITCH_MAX);
  };
  const endDrag = (e: PointerEvent) => {
    dragging = false;
    surface.classList.remove("drag");
    // capture was set explicitly on pointerdown → release it explicitly, so a
    // pointercancel (stylus lift, browser interrupt) can't strand the capture.
    try {
      surface.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
  };
  const onContextMenu = (e: Event) => e.preventDefault(); // immersive — no OS menu, no stranded drag

  // ── wheel dolly (accumulate into an eased budget so motion ramps) ────────────
  const onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement)?.closest?.(".widget")) return; // let widgets scroll internally
    dolly += -e.deltaY * 0.006;
  };

  // ── keyboard ────────────────────────────────────────────────────────────────
  const KEYMAP: Record<string, keyof typeof keys> = {
    KeyW: "fwd",
    ArrowUp: "fwd",
    KeyS: "back",
    ArrowDown: "back",
    KeyA: "rotL",
    ArrowLeft: "rotL",
    KeyD: "rotR",
    ArrowRight: "rotR",
    KeyQ: "left",
    KeyE: "right",
  };
  const typingInField = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a?.matches?.("input,textarea,[contenteditable]");
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (typingInField()) return;
    if (e.key === "Shift") {
      keys.sprint = true;
      return;
    }
    const m = KEYMAP[e.code];
    if (m) {
      keys[m] = true;
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") {
      keys.sprint = false;
      return;
    }
    const m = KEYMAP[e.code];
    if (m) keys[m] = false;
  };
  // Leaving the window drops held keys / drag so the camera can't drift on return.
  const onBlur = () => {
    keys.fwd = keys.back = keys.left = keys.right = keys.rotL = keys.rotR = keys.sprint = false;
    dragging = false;
    surface.classList.remove("drag");
  };

  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);
  surface.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    pos,
    yaw: () => yaw,
    pitch: () => pitch,
    update() {
      // eased first-person movement: accelerate toward a target velocity, glide
      // to a stop. yaw is unchanged until the very end, so the forward vector
      // computed here is reused for the dolly step below.
      _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      _right.crossVectors(_fwd, _up).normalize();
      _want.set(0, 0, 0);
      if (keys.fwd) _want.add(_fwd);
      if (keys.back) _want.addScaledVector(_fwd, -1);
      if (keys.right) _want.add(_right);
      if (keys.left) _want.addScaledVector(_right, -1);
      const moving = _want.lengthSq() > 0;
      const targetSpeed = MOVE_SPEED * (keys.sprint ? 2.0 : 1);
      if (moving) {
        _want.y = 0;
        _want.normalize().multiplyScalar(targetSpeed);
      }
      moveVel.lerp(_want, moving ? 0.16 : 0.1); // ease-in on press, ease-out on release
      if (moveVel.lengthSq() < 1e-7) moveVel.set(0, 0, 0);
      pos.add(moveVel);
      // eased wheel dolly — consume the budget exponentially so motion ramps
      if (dolly) {
        const step = dolly * 0.16;
        pos.addScaledVector(_fwd, step);
        dolly -= step;
        if (Math.abs(dolly) < 1e-4) dolly = 0;
      }
      // eased keyboard turn (A/D / arrows)
      const turn = (keys.rotL ? 1 : 0) - (keys.rotR ? 1 : 0);
      yawVel += (turn * ROT_SPEED - yawVel) * (turn ? 0.16 : 0.1);
      if (Math.abs(yawVel) < 1e-5) yawVel = 0;
      if (yawVel) yaw += yawVel;
      // glide back to the walking plane if something left us elevated
      pos.y += (0 - pos.y) * 0.08;
      if (Math.abs(pos.y) < 1e-4) pos.y = 0;
    },
    dispose() {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", endDrag);
      surface.removeEventListener("pointercancel", endDrag);
      surface.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
