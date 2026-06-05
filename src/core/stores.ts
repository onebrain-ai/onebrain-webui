// Shared app state — @preact/signals (spec §5: "stores"). Fine-grained, no
// provider tree: any component that reads a signal re-renders only when that
// signal changes. The signals here are the cross-panel coordination state
// (which file is open, the daemon handle); panel-local state stays in the panel.

import { signal } from "@preact/signals";
import type { DaemonClient } from "./daemon";

/** The active data client. Set once at boot (`main.tsx`); panels read it via
 *  their `PanelContext`, never this signal directly — but the shells need it to
 *  build the context. */
export const daemon = signal<DaemonClient | null>(null);

/** Vault-relative path of the note currently shown in the Preview panel, or
 *  `null` for the empty state. Explorer writes it, Preview reads it. */
export const openFile = signal<string | null>(null);

/** Lowercased note basename (without `.md`) → vault path, built from the tree by
 *  Explorer. Lets Preview resolve `[[wikilinks]]` to an openable path without a
 *  dedicated daemon resolve endpoint (that lands with qmd search in step 2b). */
export const vaultIndex = signal<Map<string, string>>(new Map());

/** Resolve a `[[wikilink]]` target to a vault path (or null). Matches on the
 *  note basename, case-insensitively, with or without a trailing `.md`. */
export function resolveWikilink(target: string): string | null {
  const key = target.trim().replace(/\.md$/i, "").toLowerCase();
  return vaultIndex.value.get(key) ?? null;
}

/** Which view the main region shows: the note Preview or the Settings panel. */
export const mainView = signal<"preview" | "settings">("preview");

/** Whether the right-hand chat dock is expanded. Persisted to localStorage so
 *  the choice survives reloads (matches the 05-29 chat-dock behaviour). Defaults
 *  CLOSED until the agent runtime lands — the dock is a stub, so first-run
 *  shouldn't open onto a dead panel (R1 L4). */
export const chatOpen = signal<boolean>(loadBool("onebrain.chatOpen", false));

export function setChatOpen(open: boolean): void {
  chatOpen.value = open;
  saveBool("onebrain.chatOpen", open);
}

// ── Theme settings (DS accent + density) ─────────────────────────────────────
// The DS "section-accent system": components read `--section-accent`, so
// re-keying one CSS variable re-tints the whole surface (DS colors_and_type.css).
// Density maps to the DS `[data-density="compact"]` hook.

/** The four DS neon accents (colors_and_type.css). `cyan` is the DS default. */
export const ACCENTS = {
  cyan: "#00f3ff",
  violet: "#bc13fe",
  magenta: "#ff2d92",
  amber: "#ffb000",
} as const;
export type AccentName = keyof typeof ACCENTS;

export const accent = signal<AccentName>(loadAccent());
export const density = signal<"comfortable" | "compact">(
  loadString("onebrain.density", "comfortable") === "compact" ? "compact" : "comfortable",
);

/** Re-tint the surface by overriding `--section-accent` on :root (DS pattern). */
export function setAccent(name: AccentName): void {
  accent.value = name;
  applyAccent(name);
  saveString("onebrain.accent", name);
}

export function setDensity(d: "comfortable" | "compact"): void {
  density.value = d;
  applyDensity(d);
  saveString("onebrain.density", d);
}

/** Apply the persisted theme settings to the document. Call once at boot. */
export function applyThemeSettings(): void {
  applyAccent(accent.value);
  applyDensity(density.value);
}

function applyAccent(name: AccentName): void {
  // Re-key the DS accent system: `--section-accent` drives our app frame, while
  // the DS component layer (.cyber-*, .accent-dot, switches) reads
  // `--action-primary` (+ its weak tint). `--focus-ring` is `var(--action-primary)`
  // in the DS, so it follows automatically.
  const hex = ACCENTS[name];
  const root = document.documentElement.style;
  root.setProperty("--section-accent", hex);
  root.setProperty("--action-primary", hex);
  root.setProperty("--action-primary-weak", `color-mix(in srgb, ${hex} 12%, transparent)`);
}
function applyDensity(d: "comfortable" | "compact"): void {
  if (d === "compact") document.documentElement.setAttribute("data-density", "compact");
  else document.documentElement.removeAttribute("data-density");
}

function loadAccent(): AccentName {
  const v = loadString("onebrain.accent", "cyan");
  return v in ACCENTS ? (v as AccentName) : "cyan";
}

// ── localStorage helpers (private-mode safe) ─────────────────────────────────
function saveBool(key: string, v: boolean): void {
  saveString(key, v ? "1" : "0");
}
function loadBool(key: string, dflt: boolean): boolean {
  const v = loadString(key, dflt ? "1" : "0");
  return v !== "0";
}
function saveString(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // localStorage unavailable (private mode) — state still works in-session.
  }
}
function loadString(key: string, dflt: string): string {
  try {
    return localStorage.getItem(key) ?? dflt;
  } catch {
    return dflt;
  }
}
