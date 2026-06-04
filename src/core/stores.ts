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

/** Whether the right-hand chat dock is expanded. Persisted to localStorage so
 *  the choice survives reloads (matches the 05-29 chat-dock behaviour). */
export const chatOpen = signal<boolean>(loadChatOpen());

export function setChatOpen(open: boolean): void {
  chatOpen.value = open;
  try {
    localStorage.setItem("onebrain.chatOpen", open ? "1" : "0");
  } catch {
    // localStorage unavailable (private mode) — state still works in-session.
  }
}

function loadChatOpen(): boolean {
  try {
    return localStorage.getItem("onebrain.chatOpen") !== "0"; // default open
  } catch {
    return true;
  }
}
