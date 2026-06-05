// Input — drag-look on the #look surface + the keyboard. Replaces the old
// controls.ts: it mutates the shared rig (and, when focused/exposé, routes to the
// focus/view/exposé actions). Movement integration lives in rig.updateMovement.
// Ported from the prototype look/keydown handlers (1623–1694).

import { LOOK_SENS, PITCH_MIN, PITCH_MAX, clamp, clearKeys, type Rig } from "./rig";
import type { FocusActions } from "./focus";

const KEYMAP: Record<string, keyof Rig["keys"]> = {
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

export interface InputDeps {
  focus: FocusActions;
  /** exposé actions (M5b) — when absent, key 0 / backdrop-tap do nothing extra. */
  expose?: { exposeAll(): void; collapseExpose(): void };
  /** view bookmarks (M5b) — when absent, 1–9 do nothing. */
  views?: { recallView(i: number): void };
  /** toggle the help sheet (H) — M5c. */
  onHelp?: () => void;
}

export interface Input {
  dispose(): void;
}

export function attachInput(surface: HTMLElement, rig: Rig, deps: InputDeps): Input {
  const { focus } = deps;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pressStart: { x: number; y: number } | null = null;

  const grab = () => {
    try {
      window.focus();
      surface.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  };
  const typingInField = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a?.matches?.("input,textarea,[contenteditable]");
  };

  // ── look surface ────────────────────────────────────────────────────────────
  const onPointerDown = (e: PointerEvent) => {
    if (rig.exposeActive) {
      deps.expose?.collapseExpose();
      grab();
      return;
    }
    if (e.button !== 0) return;
    grab();
    if (rig.focusedRec) {
      // focused: a click on the backdrop exits focus (decided on release)
      surface.setPointerCapture(e.pointerId);
      pressStart = { x: e.clientX, y: e.clientY };
      dragging = false;
      return;
    }
    lastX = e.clientX;
    lastY = e.clientY;
    surface.setPointerCapture(e.pointerId);
    dragging = true;
    surface.classList.add("drag");
    rig.activeViewId = null; // a manual look ends a recalled bookmark
  };
  const onPointerMove = (e: PointerEvent) => {
    if (rig.focusedRec) return; // never rotate while focused
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
    rig.yaw -= dx * LOOK_SENS;
    rig.pitch = clamp(rig.pitch - dy * LOOK_SENS, PITCH_MIN, PITCH_MAX);
  };
  const endDrag = (e: PointerEvent) => {
    if (rig.focusedRec) {
      if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) < 8) focus.clearFocus();
      pressStart = null;
      try {
        surface.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    dragging = false;
    surface.classList.remove("drag");
    try {
      surface.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onContextMenu = (e: Event) => e.preventDefault();
  const onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement)?.closest?.(".widget")) return;
    if (rig.focusedRec || rig.viewTween || rig.exposeActive) return;
    rig.dolly += -e.deltaY * 0.006;
  };

  // ── keyboard ────────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (typingInField()) return;
    if (e.code === "KeyH") {
      deps.onHelp?.();
      e.preventDefault();
      return;
    }
    if (e.code === "Digit0" || e.code === "Numpad0") {
      if (rig.focusedRec) focus.clearFocus();
      else deps.expose?.exposeAll();
      grab();
      e.preventDefault();
      return;
    }
    if (rig.exposeActive) {
      if (e.code === "Escape") deps.expose?.collapseExpose();
      e.preventDefault();
      return;
    }
    if (rig.focusedRec) {
      if (e.code === "ArrowLeft") {
        focus.cycleFocus(-1);
        e.preventDefault();
        return;
      }
      if (e.code === "ArrowRight") {
        focus.cycleFocus(1);
        e.preventDefault();
        return;
      }
      if (/^Digit[1-9]$/.test(e.code)) {
        deps.views?.recallView(+e.code.slice(5) - 1);
        grab();
        e.preventDefault();
        return;
      }
      if (e.code === "Escape") {
        focus.clearFocus();
        e.preventDefault();
        return;
      }
      e.preventDefault(); // WASD / wheel locked — exit focus first
      return;
    }
    if (/^Digit[1-9]$/.test(e.code)) {
      deps.views?.recallView(+e.code.slice(5) - 1);
      grab();
      e.preventDefault();
      return;
    }
    if (e.key === "Shift") {
      rig.keys.sprint = true;
      return;
    }
    const m = KEYMAP[e.code];
    if (m) {
      rig.keys[m] = true;
      rig.activeViewId = null;
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") {
      rig.keys.sprint = false;
      return;
    }
    const m = KEYMAP[e.code];
    if (m) rig.keys[m] = false;
  };
  const onBlur = () => {
    clearKeys(rig);
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
