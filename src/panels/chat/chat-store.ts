// Chat state — module-level signals so the conversation survives the chat dock
// being toggled closed (which unmounts the panel). Threads + the claude session
// id are persisted to localStorage so history and context retention both survive
// a reload: the visible transcript comes from storage, and the stored session id
// is replayed as `--resume` so the agent keeps full prior context.

import { signal } from "@preact/signals";
import type { DaemonClient } from "../../core/daemon";

export interface ChatMsg {
  role: "you" | "ai";
  text: string;
  /** true while the assistant reply is still streaming in. */
  streaming?: boolean;
  /** true if this turn failed (rendered as an error bubble). */
  error?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  /** claude session id for `--resume` (null until the first turn completes). */
  sessionId: string | null;
  messages: ChatMsg[];
  updatedAt: number;
}

const KEY = "onebrain.chat.threads";
const MAX_THREADS = 30;
const MAX_MSGS = 200; // per-thread cap so a long conversation can't blow localStorage

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function blankThread(): ChatThread {
  return { id: rid(), title: "New chat", sessionId: null, messages: [], updatedAt: Date.now() };
}

function load(): ChatThread[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatThread[];
      if (Array.isArray(parsed) && parsed.length) {
        // A reload can land mid-stream — storage may hold a `streaming:true`
        // message (persisted on the `session` event, before any delta) plus an
        // empty trailing placeholder that will never complete. Make the restored
        // transcript inert: clear the flag and drop a trailing empty AI bubble.
        for (const t of parsed) {
          if (!Array.isArray(t.messages)) { t.messages = []; continue; }
          for (const m of t.messages) m.streaming = false;
          const last = t.messages[t.messages.length - 1];
          if (last && last.role === "ai" && !last.text) t.messages.pop();
        }
        return parsed;
      }
    }
  } catch {
    /* private mode / corrupt — start fresh */
  }
  return [];
}

const initial = load();
export const threads = signal<ChatThread[]>(initial.length ? initial : [blankThread()]);
export const activeId = signal<string>(threads.value[0].id);
/** The set of thread ids with a turn in flight — per-thread so starting a NEW
 *  chat (or switching threads) stays interactive while another thread streams. */
export const busyIds = signal<Set<string>>(new Set());

/** AbortControllers for in-flight turns, keyed by thread id (not a signal — the
 *  controller itself isn't render state). */
const aborts = new Map<string, AbortController>();

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(threads.value.slice(0, MAX_THREADS)));
  } catch {
    /* over quota / private mode — keep working in-session */
  }
}

export function activeThread(): ChatThread | undefined {
  return threads.value.find((t) => t.id === activeId.value);
}

export function isBusy(id: string): boolean {
  return busyIds.value.has(id);
}

function setBusy(id: string, on: boolean): void {
  const next = new Set(busyIds.value);
  if (on) next.add(id);
  else next.delete(id);
  busyIds.value = next;
}

function update(id: string, fn: (t: ChatThread) => ChatThread): void {
  threads.value = threads.value.map((t) => (t.id === id ? fn(t) : t));
}

/** Patch the thread's LAST message (the in-flight assistant reply). */
function patchLast(id: string, fn: (m: ChatMsg) => ChatMsg): void {
  update(id, (t) => {
    if (!t.messages.length) return t;
    const msgs = t.messages.slice();
    msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
    return { ...t, messages: msgs, updatedAt: Date.now() };
  });
}

export function newThread(): void {
  const t = blankThread();
  threads.value = [t, ...threads.value].slice(0, MAX_THREADS);
  activeId.value = t.id;
  persist();
}

export function selectThread(id: string): void {
  activeId.value = id;
}

/** Cancel the in-flight turn for a thread (the streamed reply so far is kept). */
export function stop(id: string): void {
  aborts.get(id)?.abort();
}

/** Send one turn: append the user message + a streaming assistant placeholder,
 *  then stream the reply, retaining the session id for context on the next turn.
 *  Targets a captured thread id, so it keeps writing to the originating thread
 *  even if the user switches/creates a thread mid-stream. */
export async function send(daemon: DaemonClient, raw: string): Promise<void> {
  const message = raw.trim();
  const t = activeThread();
  if (!message || !t || isBusy(t.id)) return;
  const id = t.id;
  setBusy(id, true);

  update(id, (th) => {
    const trimmed = th.messages.length > MAX_MSGS - 2 ? th.messages.slice(-(MAX_MSGS - 2)) : th.messages;
    return {
      ...th,
      title: th.messages.length === 0 ? message.slice(0, 42) : th.title,
      messages: [...trimmed, { role: "you", text: message }, { role: "ai", text: "", streaming: true }],
      updatedAt: Date.now(),
    };
  });

  const ac = new AbortController();
  aborts.set(id, ac);
  try {
    await daemon.chat(
      { message, sessionId: t.sessionId },
      (e) => {
        switch (e.type) {
          case "session":
            update(id, (th) => ({ ...th, sessionId: e.sessionId }));
            // Persist the session id immediately so a mid-stream reload can still
            // resume the conversation (context retention survives a crash/reload).
            persist();
            break;
          case "delta":
            patchLast(id, (m) => ({ ...m, text: m.text + e.text }));
            break;
          case "done":
            patchLast(id, (m) => ({ ...m, streaming: false, error: e.isError || m.error, text: m.text || e.result }));
            break;
          case "error":
            patchLast(id, (m) => ({ ...m, streaming: false, error: true, text: m.text || e.message }));
            break;
        }
      },
      ac.signal,
    );
  } catch (err) {
    if (ac.signal.aborted) {
      patchLast(id, (m) => ({ ...m, streaming: false, text: m.text || "(stopped)" }));
    } else {
      const msg = err instanceof Error ? err.message : "could not reach the agent";
      patchLast(id, (m) => ({ ...m, streaming: false, error: true, text: m.text || msg }));
    }
  } finally {
    patchLast(id, (m) => ({ ...m, streaming: false }));
    aborts.delete(id);
    setBusy(id, false);
    persist();
  }
}
