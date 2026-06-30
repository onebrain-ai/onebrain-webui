// Accent store — the re-keyable UI accent (Settings picker). Writes the
// `--section-accent` CSS custom property on :root (every panel rule keys off it
// via --accent-weak / --accent-line), mirrors the choice into a signal the
// Settings swatches subscribe to, and persists it. Ported from the prototype
// (ACCENTS/ACCENT_HEX 1294–1297, setAccent 1934–1945).

import { signal } from "@preact/signals";

/** the six operator accents (hex), keyed by name. Object order = swatch order. */
export const ACCENT_HEX: Record<string, string> = {
  cyan: "#00f3ff",
  violet: "#bc13fe",
  magenta: "#ff2d92",
  amber: "#ffb000",
  lime: "#a8d000",
  grey: "#a1a1aa",
};
export const ACCENT_KEYS = Object.keys(ACCENT_HEX);

const STORE_KEY = "ob-spatial-accent";

function initialAccent(): string {
  try {
    const a = localStorage.getItem(STORE_KEY);
    if (a && ACCENT_HEX[a]) return a;
  } catch {
    /* sandboxed storage — fall through to the default */
  }
  return "cyan";
}

/** the active accent NAME (e.g. "cyan"). Settings swatches subscribe to this. */
export const accentName = signal<string>(initialAccent());

/** apply an accent: update the signal, write the CSS var, persist. */
export function setAccent(name: string): void {
  if (!ACCENT_HEX[name]) return;
  accentName.value = name;
  document.documentElement.style.setProperty("--section-accent", ACCENT_HEX[name]);
  try {
    localStorage.setItem(STORE_KEY, name);
  } catch {
    /* ignore */
  }
}

/** Apply the persisted accent at boot (writes the CSS var to match the signal,
 *  overriding the tokens.css default so getComputedStyle resolves a real hex). */
export function initAccent(): void {
  setAccent(accentName.peek());
}
