// In-app webview state. Module-level signals so the choice of layout mode and
// the open URL survive the editor re-rendering. Preflight (via the daemon)
// decides iframe-vs-new-tab; any doubt degrades to a new tab.

import { signal } from "@preact/signals";
import type { DaemonClient } from "../../core/daemon";

export type WebviewMode = "pane" | "side";
const MODE_KEY = "onebrain.webviewMode";

function loadMode(): WebviewMode {
  try {
    return localStorage.getItem(MODE_KEY) === "side" ? "side" : "pane";
  } catch {
    return "pane"; // private mode / localStorage unavailable — default
  }
}

export const webviewOpen = signal<boolean>(false);
export const webviewUrl = signal<string | null>(null);
export const webviewMode = signal<WebviewMode>(loadMode());
export const webviewNotice = signal<string | null>(null);

// Monotonic request sequence. Guards against two overlapping openExternalLink
// calls resolving out of order (a slow first click landing after a fast
// second click), and against a preflight resolving after closeWebview() was
// already called (e.g. the user switched notes while it was in flight).
let requestSeq = 0;

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function flashNotice(msg: string): void {
  webviewNotice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    webviewNotice.value = null;
  }, 4000);
}

function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
  flashNotice("This site can't be embedded — opened it in a new tab.");
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
    openInNewTab(url);
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
