// Ambient / battery-saver motion gate. When off, the living-world motion (star
// twinkle/drift/shooting stars, camera breathing, radar sweep) freezes. Folds in
// the OS reduced-motion preference so every site reads one helper. Ported from
// the prototype (lines 1284–1290).

/** OS "reduce motion" preference, evaluated once at load. */
export const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let ambient = true;
try {
  ambient = localStorage.getItem("ob-ambient") !== "0";
} catch {
  /* sandboxed storage — default to ambient on */
}

/** true → freeze ambient motion (reduced-motion preference OR ambient off). */
export function lowMotion(): boolean {
  return reduceMotion || !ambient;
}

/** Toggle ambient motion (the Settings switch, M5). Persists the choice. */
export function setAmbient(on: boolean): void {
  ambient = on;
  try {
    localStorage.setItem("ob-ambient", on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
