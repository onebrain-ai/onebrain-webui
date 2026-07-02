// In-app webview state. Module-level signals so the choice of layout mode and
// the open URL survive the editor re-rendering. Preflight (via the daemon)
// decides iframe-vs-new-tab; any doubt degrades to a new tab.

import { signal } from "@preact/signals";
import type { DaemonClient } from "../../core/daemon";
import { confirmModal } from "../../ui/Modal";

export type WebviewMode = "pane" | "side";
const MODE_KEY = "onebrain.webviewMode";

function loadMode(): WebviewMode {
  try {
    return localStorage.getItem(MODE_KEY) === "side" ? "side" : "pane";
  } catch {
    /* v8 ignore start -- private-mode localStorage throw; not reliably reproducible across jsdom/CI envs */
    return "pane";
    /* v8 ignore stop */
  }
}

export const webviewOpen = signal<boolean>(false);
export const webviewUrl = signal<string | null>(null);
export const webviewMode = signal<WebviewMode>(loadMode());

// Side-panel width in px (drag-resizable), clamped + persisted — mirrors the
// shell's sidebar/chat-dock resize. Only applies in `side` mode; `pane` is full.
export const WEBVIEW_MIN = 360;
export const WEBVIEW_MAX = 1400;
const WIDTH_KEY = "onebrain.webviewWidth";
function clampWidth(px: number): number {
  return Math.max(WEBVIEW_MIN, Math.min(WEBVIEW_MAX, Math.round(px)));
}
function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n > 0 ? clampWidth(n) : 720; // absent/NaN/0 → default
  } catch {
    /* v8 ignore start -- private-mode localStorage throw; not reliably reproducible across jsdom/CI envs */
    return 720;
    /* v8 ignore stop */
  }
}
export const webviewWidth = signal<number>(loadWidth());
export function setWebviewWidth(px: number): void {
  const w = clampWidth(px);
  webviewWidth.value = w;
  try {
    localStorage.setItem(WIDTH_KEY, String(w));
  } catch {
    /* private mode — width still updates in-session */
  }
}

// Monotonic request sequence. Guards against two overlapping openExternalLink
// calls resolving out of order (a slow first click landing after a fast
// second click), and against a preflight resolving after closeWebview() was
// already called (e.g. the user switched notes while it was in flight).
let requestSeq = 0;

/** Fallback for a link that can't be framed (or a frame that never loaded):
 *  ASK before popping a new tab instead of doing it silently. Bonus: the
 *  window.open fires from the OK click — a fresh user gesture — so popup
 *  blockers can't eat the tab (an async-preflight or 8s-timer open could be
 *  outside the browser's transient-activation window). */
export async function confirmAndOpenNewTab(url: string): Promise<void> {
  const ok = await confirmModal({
    title: "Open in a new tab?",
    message: `This site can't be shown inside the app — ${url}`,
    okLabel: "Open tab",
  });
  if (ok) window.open(url, "_blank", "noopener,noreferrer");
}

/** Intercept target: preflight, then frame in-app or fall back to a new tab. */
export async function openExternalLink(
  url: string,
  daemon: Pick<DaemonClient, "webviewPreflight">,
): Promise<void> {
  const seq = ++requestSeq;
  let frameable = false;
  try {
    frameable = await daemon.webviewPreflight(url);
  } catch {
    frameable = false; // any preflight failure → safe fallback
  }
  // A newer click (or a close/note-switch) superseded this request while the
  // preflight was in flight — drop the result, whichever way it resolved.
  if (seq !== requestSeq) return;
  if (frameable) {
    webviewUrl.value = url;
    webviewOpen.value = true;
  } else {
    await confirmAndOpenNewTab(url);
  }
}

export function closeWebview(): void {
  requestSeq++; // invalidate any in-flight preflight so it can't reopen the panel
  webviewOpen.value = false;
  webviewUrl.value = null;
}

export function toggleWebviewMode(): void {
  const next: WebviewMode = webviewMode.value === "pane" ? "side" : "pane";
  webviewMode.value = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    /* private mode / localStorage unavailable — mode still updates in-session */
  }
}
