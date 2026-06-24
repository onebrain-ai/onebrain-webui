// Ambient / battery-saver motion gate. When off, the living-world motion (star
// twinkle/drift/shooting stars, camera breathing, radar sweep) freezes. Folds in
// the OS reduced-motion preference so every site reads one helper. Ported from
// the prototype (lines 1284–1290).

import { signal } from "@preact/signals";

/** OS "reduce motion" preference, evaluated once at load. */
export const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function initialAmbient(): boolean {
  try {
    return localStorage.getItem("ob-ambient") !== "0";
  } catch {
    return true; // sandboxed storage — default to ambient on
  }
}

/** Ambient motion on/off. A signal so the Settings switch reflects + toggles it
 *  reactively; the hot-path `lowMotion()` reads it via `.peek()` (no subscribe). */
export const ambientOn = signal<boolean>(initialAmbient());

/** true → freeze ambient motion (reduced-motion preference OR ambient off). */
export function lowMotion(): boolean {
  return reduceMotion || !ambientOn.peek();
}

/** Toggle ambient motion (the Settings switch, M5c). Persists the choice. */
export function setAmbient(on: boolean): void {
  ambientOn.value = on;
  try {
    localStorage.setItem("ob-ambient", on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
