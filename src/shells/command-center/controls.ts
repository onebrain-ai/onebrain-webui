// Explore navigation + the render loop for the command center.
//
// Navigation model (from the prototype's "Explore" mode):
//  - drag on EMPTY space (the WebGL canvas behind the panels) → look (yaw/pitch)
//  - WASD / arrow keys → move on the walking plane
//  - wheel → dolly forward/back
// Dragging ON a panel does nothing here (the CSS3D layer's panels own those
// pointer events), so clicking/scrolling a panel never yanks the camera.
//
// The loop is frame-rate-capped (accumulator) so a low-GPU host can throttle to
// 30fps — the prototype's battery-saver lever.

import type { PerspectiveCamera, WebGLRenderer } from "three";
import { Vector3 } from "three";
import type { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";

export interface ControlsOptions {
  camera: PerspectiveCamera;
  gl: WebGLRenderer;
  css3d: CSS3DRenderer;
  /** The element drag-look listens on (the WebGL canvas / background). */
  surface: HTMLElement;
  scene: import("three").Scene;
  /** Called once per rendered frame with the live camera (drives the HUD). */
  onFrame?: (camera: PerspectiveCamera) => void;
  /** Frames-per-second cap (30/60/120). */
  fpsCap?: number;
}

export interface Controls {
  setFpsCap(fps: number): void;
  dispose(): void;
}

const MOVE_SPEED = 6; // world units / second
const LOOK_SENS = 0.0026; // radians / pixel
const PITCH_LIMIT = 1.0; // clamp so the operator can't flip over

export function attachControls(opts: ControlsOptions): Controls {
  const { camera, gl, css3d, surface, scene, onFrame } = opts;

  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;
  const keys = new Set<string>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // ── Look (drag on background) ──────────────────────────────────────────────
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    surface.setPointerCapture(e.pointerId);
    surface.style.cursor = "grabbing";
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * LOOK_SENS;
    pitch -= (e.clientY - lastY) * LOOK_SENS;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    try {
      surface.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    surface.style.cursor = "grab";
  };

  // ── Move (keyboard) ────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    // Don't hijack typing inside a panel input/textarea.
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    keys.add(e.key.toLowerCase());
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

  // Leaving the window (alt-tab / focus loss) drops any held keys + in-progress
  // drag — otherwise a key held during the switch never gets its keyup and the
  // camera drifts forever on return (R1 M2).
  const onBlur = () => {
    keys.clear();
    dragging = false;
    surface.style.cursor = "grab";
  };

  // ── Dolly (wheel) ──────────────────────────────────────────────────────────
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const forward = new Vector3(0, 0, -1).applyEuler(camera.rotation);
    camera.position.addScaledVector(forward, -e.deltaY * 0.01);
  };

  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp); // lost capture → end drag (R1 L2)
  surface.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  surface.style.cursor = "grab";

  // ── Render loop (fps-capped accumulator) ───────────────────────────────────
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let frameInterval = 1000 / (opts.fpsCap ?? 60);

  const step = (now: number) => {
    raf = requestAnimationFrame(step);
    // Clamp dt so a long stall (backgrounded tab — RAF pauses) can't deliver a
    // multi-second frame that flings the camera on return (R1 M2).
    const dt = Math.min(now - last, 100);
    last = now;
    acc += dt;
    if (acc < frameInterval) return; // throttle to the cap
    // Integrate only the WHOLE frame-intervals consumed this tick; the
    // sub-interval remainder carries forward (R1 M1: carrying it stops the cap
    // aliasing against the display refresh). Using the full `acc` here would
    // double-count the carried remainder and make movement speed scale with the
    // refresh rate — ~1.5× too fast at 120Hz (R2 BLOCKER).
    const elapsed = (acc - (acc % frameInterval)) / 1000;
    acc %= frameInterval;

    // Keyboard movement on the view plane.
    const dir = new Vector3();
    if (keys.has("w") || keys.has("arrowup")) dir.z -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dir.z += 1;
    if (keys.has("a") || keys.has("arrowleft")) dir.x -= 1;
    if (keys.has("d") || keys.has("arrowright")) dir.x += 1;
    if (dir.lengthSq() > 0) {
      dir.normalize().applyEuler(camera.rotation);
      dir.y = 0; // stay on the walking plane
      camera.position.addScaledVector(dir, MOVE_SPEED * elapsed);
    }

    camera.rotation.set(pitch, yaw, 0, "YXZ");

    gl.render(scene, camera);
    css3d.render(scene, camera);
    onFrame?.(camera);
  };
  raf = requestAnimationFrame(step);

  return {
    setFpsCap(fps: number) {
      frameInterval = 1000 / Math.max(1, fps);
    },
    dispose() {
      cancelAnimationFrame(raf);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
      surface.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
