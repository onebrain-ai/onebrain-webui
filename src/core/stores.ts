// Shared app state — @preact/signals (spec §5: "stores"). Fine-grained, no
// provider tree: any component that reads a signal re-renders only when that
// signal changes. The signals here are the cross-panel coordination state
// (which file is open, the daemon handle); panel-local state stays in the panel.

import { signal } from "@preact/signals";

/** Whether the right-hand chat dock is expanded. Persisted to localStorage so
 *  the choice survives reloads (matches the 05-29 chat-dock behaviour). Defaults
 *  CLOSED until the agent runtime lands — the dock is a stub, so first-run
 *  shouldn't open onto a dead panel (R1 L4). */
export const chatOpen = signal<boolean>(loadBool("onebrain.chatOpen", false));

export function setChatOpen(open: boolean): void {
  chatOpen.value = open;
  saveBool("onebrain.chatOpen", open);
}

// ── Sidebar (CMS explorer column) — resizable + collapsible ──────────────────
/** Sidebar width in px (drag-resizable). Clamped to [SIDEBAR_MIN, SIDEBAR_MAX]. */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 560;
export const sidebarWidth = signal<number>(
  clampNum(loadNum("onebrain.sidebarWidth", 280), SIDEBAR_MIN, SIDEBAR_MAX),
);
/** Whether the sidebar is collapsed (hidden, leaving just the rail). */
export const sidebarCollapsed = signal<boolean>(loadBool("onebrain.sidebarCollapsed", false));

export function setSidebarWidth(px: number): void {
  const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
  sidebarWidth.value = w;
  saveString("onebrain.sidebarWidth", String(w));
}
export function setSidebarCollapsed(v: boolean): void {
  sidebarCollapsed.value = v;
  saveBool("onebrain.sidebarCollapsed", v);
}
export function toggleSidebar(): void {
  setSidebarCollapsed(!sidebarCollapsed.value);
}

// ── Which panel fills the sidebar + the live search query ─────────────────────
// Module-level (not CmsShell-local) so any surface can switch tabs — e.g. clicking
// a #tag in the reading view opens the Search panel pre-filled.
export type SidebarTab = "explorer" | "search" | "tasks" | "status" | "memory";
export const sidebarTab = signal<SidebarTab>("explorer");
export const searchQuery = signal<string>("");

/** Open the Search panel pre-filled with `query` (and ensure the sidebar is open). */
export function openSearch(query: string): void {
  searchQuery.value = query;
  sidebarTab.value = "search";
  setSidebarCollapsed(false);
}

/** Chat dock width in px (drag-resizable, persisted). Collapse is `chatOpen`. */
export const CHAT_MIN = 300;
export const CHAT_MAX = 760;
export const chatWidth = signal<number>(clampNum(loadNum("onebrain.chatWidth", 360), CHAT_MIN, CHAT_MAX));
export function setChatWidth(px: number): void {
  const w = Math.max(CHAT_MIN, Math.min(CHAT_MAX, Math.round(px)));
  chatWidth.value = w;
  saveString("onebrain.chatWidth", String(w));
}

/** Whether the editor's frontmatter Properties block is folded up (persisted, so
 *  once collapsed it stays out of the way across notes). Default = expanded. */
export const propertiesCollapsed = signal<boolean>(loadBool("onebrain.propsCollapsed", false));
export function togglePropertiesCollapsed(): void {
  propertiesCollapsed.value = !propertiesCollapsed.value;
  saveBool("onebrain.propsCollapsed", propertiesCollapsed.value);
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
/** Light / dark colour scheme. Dark is the DS default; `[data-theme="light"]`
 *  overrides the grayscale tokens (tokens.css). */
export const theme = signal<"dark" | "light">(
  loadString("onebrain.theme", "dark") === "light" ? "light" : "dark",
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

export function setTheme(t: "dark" | "light"): void {
  theme.value = t;
  applyTheme(t);
  saveString("onebrain.theme", t);
}

// ── HTML preview: auto-run scripts (default OFF — safe-by-default) ────────────
// When ON, .html previews open with scripts enabled (still sandboxed:
// allow-scripts WITHOUT allow-same-origin, so the frame can't reach the app,
// vault, token, or cookies). When OFF, previews are static and the editor's
// "Run" button is a per-file opt-in. Untrusted .html (import / sync / AI) is why
// this defaults off.
export const htmlAutorun = signal<boolean>(loadString("onebrain.htmlAutorun", "0") === "1");
export function setHtmlAutorun(on: boolean): void {
  htmlAutorun.value = on;
  saveString("onebrain.htmlAutorun", on ? "1" : "0");
}

// ── Media preview: auto-play audio / video on open (default OFF) ──────────────
// Browsers may still gate UNMUTED autoplay until a user gesture (the explorer
// click usually counts); either way the native controls work.
export const mediaAutoplay = signal<boolean>(loadString("onebrain.mediaAutoplay", "0") === "1");
export function setMediaAutoplay(on: boolean): void {
  mediaAutoplay.value = on;
  saveString("onebrain.mediaAutoplay", on ? "1" : "0");
}

// ── Settings modal: last-viewed category ─────────────────────────────────────
// The settings modal is a two-pane console (category rail + content). Persisting
// the active category means reopening the modal lands where you left off.
export type SettingsCat = "appearance" | "preview" | "vault" | "about";
const SETTINGS_CATS: readonly SettingsCat[] = ["appearance", "preview", "vault", "about"];
export const settingsCategory = signal<SettingsCat>(loadSettingsCategory());
export function setSettingsCategory(cat: SettingsCat): void {
  settingsCategory.value = cat;
  saveString("onebrain.settingsCat", cat);
}
function loadSettingsCategory(): SettingsCat {
  const v = loadString("onebrain.settingsCat", "appearance");
  return (SETTINGS_CATS as readonly string[]).includes(v) ? (v as SettingsCat) : "appearance";
}

/** Apply the persisted theme settings to the document. Call once at boot. */
export function applyThemeSettings(): void {
  applyAccent(accent.value);
  applyDensity(density.value);
  applyTheme(theme.value);
}

function applyAccent(name: AccentName): void {
  // Re-key the DS accent system: `--section-accent` drives our app frame, while
  // the DS component layer (.cyber-*, .accent-dot, switches) reads
  // `--action-primary` (+ its weak tint). `--focus-ring` is `var(--action-primary)`
  // in the DS, so it follows automatically.
  // Bind to the theme TOKEN (`var(--acc-*)`), not the fixed hex from ACCENTS, so
  // the accent adapts to light/dark: tokens.css darkens the neon `--acc-*` on a
  // light surface (cyan #00f3ff is ~1.3:1 / unreadable on the light bg). The named
  // accent only picks the HUE; the token supplies the theme-correct shade. (ACCENTS
  // hexes are still used for the settings-modal swatches.)
  const v = `var(--acc-${name})`;
  const root = document.documentElement.style;
  root.setProperty("--section-accent", v);
  root.setProperty("--action-primary", v);
  root.setProperty("--action-primary-weak", `color-mix(in srgb, ${v} 12%, transparent)`);
}
function applyDensity(d: "comfortable" | "compact"): void {
  if (d === "compact") document.documentElement.setAttribute("data-density", "compact");
  else document.documentElement.removeAttribute("data-density");
}
function applyTheme(t: "dark" | "light"): void {
  // Dark is the default token set; the attribute drives the `[data-theme="light"]`
  // overrides. `color-scheme` lets the browser theme native controls/scrollbars.
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
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
  const v = loadString(key, dflt ? /* v8 ignore next */ "1" : "0"); // all callers pass dflt=false
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
function loadNum(key: string, dflt: number): number {
  const v = Number(loadString(key, String(dflt)));
  return Number.isFinite(v) ? v : dflt;
}
function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
