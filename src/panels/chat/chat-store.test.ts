import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// jsdom runs on an opaque origin here, so the real localStorage is absent (prod
// code tolerates that via try/catch). Install a minimal in-memory shim so the
// test can actually seed + drive load().
beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a daemon mock whose chat() calls onEvent with the provided sequence of
 *  events, then resolves. */
type CE = import("../../core/daemon").ChatEvent;

function daemonWith(events: CE[]) {
  return {
    chat: vi.fn(async (_req: unknown, onEvent: (e: CE) => void) => {
      for (const e of events) onEvent(e);
    }),
  } as any;
}

/** Build a daemon mock whose chat() throws the given error. */
function daemonThrowing(err: unknown) {
  return {
    chat: vi.fn(async () => { throw err; }),
  } as any;
}

/** Build a daemon mock whose chat() waits for the AbortSignal then throws an
 *  AbortError — mirrors what fetch() does when the signal fires. */
function daemonAbortable() {
  return {
    chat: vi.fn(async (_req: unknown, _onEvent: unknown, signal?: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const e = new DOMException("aborted", "AbortError");
          reject(e);
        });
      });
    }),
  } as any;
}

// ─── send() / stop() / thread management ─────────────────────────────────────

describe("send() — streaming happy path", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("appends user+AI messages, updates sessionId, and clears streaming flag", async () => {
    const { threads, activeId, send } = await import("./chat-store");
    // Reset to a single blank thread.
    const tid = activeId.value;

    const events: CE[] = [
      { type: "session", sessionId: "sess-1" },
      { type: "delta", text: "Hello" },
      { type: "delta", text: " world" },
      { type: "done", result: "", sessionId: "sess-1", isError: false },
    ];

    await send(daemonWith(events), "ping");

    const t = threads.value.find((x) => x.id === tid)!;
    expect(t.messages[0]).toEqual({ role: "you", text: "ping" });
    expect(t.messages[1].role).toBe("ai");
    expect(t.messages[1].text).toBe("Hello world");
    expect(t.messages[1].streaming).toBe(false);
    expect(t.sessionId).toBe("sess-1");
  });

  it("sets the thread title to the first message (truncated at 42 chars)", async () => {
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;
    await send(daemonWith([{ type: "done", result: "ok", sessionId: null, isError: false }]), "A".repeat(60));
    const t = threads.value.find((x) => x.id === tid)!;
    expect(t.title).toBe("A".repeat(42));
  });

  it("marks the AI message as error when done.isError is true", async () => {
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;
    await send(
      daemonWith([{ type: "done", result: "boom", sessionId: null, isError: true }]),
      "hi",
    );
    const t = threads.value.find((x) => x.id === tid)!;
    const ai = t.messages[t.messages.length - 1];
    expect(ai.error).toBe(true);
    expect(ai.text).toBe("boom");
  });

  it("marks the AI message as error on the error event", async () => {
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;
    await send(
      daemonWith([{ type: "error", message: "agent crashed" }]),
      "hi",
    );
    const t = threads.value.find((x) => x.id === tid)!;
    const ai = t.messages[t.messages.length - 1];
    expect(ai.error).toBe(true);
    expect(ai.text).toBe("agent crashed");
  });
});

describe("send() — error / abort branches", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("marks the AI bubble as error when the daemon throws a non-abort error", async () => {
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;
    await send(daemonThrowing(new Error("network failure")), "hi");
    const t = threads.value.find((x) => x.id === tid)!;
    const ai = t.messages[t.messages.length - 1];
    expect(ai.error).toBe(true);
    expect(ai.text).toBe("network failure");
  });

  it("uses fallback message for non-Error throws", async () => {
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;
    await send(daemonThrowing("string error"), "hi");
    const t = threads.value.find((x) => x.id === tid)!;
    const ai = t.messages[t.messages.length - 1];
    expect(ai.error).toBe(true);
    expect(ai.text).toBe("could not reach the agent");
  });

  it("marks the AI bubble as '(stopped)' when the user aborts via stop()", async () => {
    const { threads, activeId, send, stop, busyIds } = await import("./chat-store");
    const tid = activeId.value;

    // Start the send, then immediately stop it; the daemon is abortable.
    const promise = send(daemonAbortable(), "hi");
    // Abort before the promise resolves.
    stop(tid);
    await promise;

    const t = threads.value.find((x) => x.id === tid)!;
    const ai = t.messages[t.messages.length - 1];
    expect(ai.streaming).toBe(false);
    expect(ai.text).toBe("(stopped)");
    expect(busyIds.value.has(tid)).toBe(false);
  });

  it("is a no-op for an empty message", async () => {
    const { threads, send } = await import("./chat-store");
    const before = threads.value[0].messages.length;
    await send(daemonWith([]), "   ");
    expect(threads.value[0].messages.length).toBe(before);
  });

  it("is a no-op when the thread is already busy", async () => {
    const { threads, activeId, busyIds, send } = await import("./chat-store");
    const tid = activeId.value;
    // Pre-mark as busy.
    busyIds.value = new Set([tid]);
    const before = threads.value[0].messages.length;
    await send(daemonWith([]), "hi");
    expect(threads.value[0].messages.length).toBe(before);
    // clean up
    busyIds.value = new Set();
  });
});

describe("newThread() / selectThread() / isBusy()", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("newThread prepends a blank thread and makes it active", async () => {
    const { threads, activeId, newThread } = await import("./chat-store");
    const before = threads.value.length;
    newThread();
    expect(threads.value.length).toBe(before + 1);
    expect(activeId.value).toBe(threads.value[0].id);
  });

  it("selectThread switches activeId", async () => {
    const { threads, activeId, newThread, selectThread } = await import("./chat-store");
    newThread();
    const second = threads.value[1].id;
    selectThread(second);
    expect(activeId.value).toBe(second);
  });

  it("isBusy returns false for a quiet thread", async () => {
    const { activeId, isBusy } = await import("./chat-store");
    expect(isBusy(activeId.value)).toBe(false);
  });
});

describe("send() — patchLast guard (empty messages)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("patchLast is a no-op if messages were cleared between the send and the event", async () => {
    // To reach the `if (!t.messages.length) return t` guard in patchLast, we need
    // a 'done' event to arrive after the thread's messages have been cleared.
    // We achieve this by intercepting the daemon chat call to clear messages mid-flight.
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;
    let capturedOnEvent: ((e: CE) => void) | null = null;

    const daemon = {
      chat: vi.fn(async (_req: unknown, onEvent: (e: CE) => void) => {
        capturedOnEvent = onEvent;
        // Don't fire events yet — hold on to the callback.
      }),
    } as any;

    // Start send but don't await — the daemon holds the chat call open.
    const sendPromise = send(daemon, "test message");

    // Wait a tick for the update to append messages, then clear them.
    await Promise.resolve();
    const tidx = threads.value.findIndex((t) => t.id === tid);
    if (tidx >= 0) {
      threads.value = threads.value.map((t) =>
        t.id === tid ? { ...t, messages: [] } : t,
      );
    }

    // Now fire a done event — patchLast sees empty messages and returns early.
    capturedOnEvent?.({ type: "done", result: "ok", sessionId: null, isError: false });
    await sendPromise;

    // Thread should still have 0 messages (patchLast was a no-op).
    const t = threads.value.find((x) => x.id === tid)!;
    expect(t.messages.length).toBe(0);
  });
});

describe("send() — title kept on subsequent turns (non-empty messages branch)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("preserves the existing title on the second turn", async () => {
    const { threads, send } = await import("./chat-store");
    // Prime the thread with an existing message (non-empty messages → keep title).
    const events: CE[] = [{ type: "done", result: "ok", sessionId: null, isError: false }];
    await send(daemonWith(events), "First message");
    const titleAfterFirst = threads.value[0].title;
    await send(daemonWith(events), "Second message");
    // Title should be unchanged after the second turn.
    expect(threads.value[0].title).toBe(titleAfterFirst);
  });

  it("trims the message history when it exceeds MAX_MSGS (198 kept)", async () => {
    // Exercises the `th.messages.length > MAX_MSGS - 2` trim branch (MAX_MSGS=200).
    const { threads, activeId, send } = await import("./chat-store");
    const tid = activeId.value;

    // Seed the thread with 200 messages directly.
    const msgs = Array.from({ length: 200 }, (_, i) => ({
      role: (i % 2 === 0 ? "you" : "ai") as "you" | "ai",
      text: `msg ${i}`,
    }));
    const idx = threads.value.findIndex((t) => t.id === tid);
    const updated = { ...threads.value[idx], messages: msgs };
    threads.value = threads.value.map((t) => (t.id === tid ? updated : t));

    const events: CE[] = [{ type: "done", result: "ok", sessionId: null, isError: false }];
    await send(daemonWith(events), "overflow");

    const t = threads.value.find((x) => x.id === tid)!;
    // trimmed to 198 + 2 new = 200
    expect(t.messages.length).toBe(200);
  });
});

describe("load() — localStorage with messages.null guard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("handles a thread whose messages field is null (not an array)", async () => {
    localStorage.setItem(
      "onebrain.chat.threads",
      JSON.stringify([
        { id: "t", title: "x", sessionId: null, updatedAt: 0, messages: null },
      ]),
    );
    const { threads } = await import("./chat-store");
    // messages is nulled → guarded to [] in load(), so the thread is kept but empty
    expect(threads.value[0].messages).toEqual([]);
  });

  it("starts fresh when localStorage holds an empty array", async () => {
    // Exercises line 45: Array.isArray(parsed) && parsed.length (false when empty).
    localStorage.setItem("onebrain.chat.threads", JSON.stringify([]));
    const { threads } = await import("./chat-store");
    // Empty stored array → load() returns [] → blankThread() seeded instead.
    expect(threads.value.length).toBe(1);
    expect(threads.value[0].title).toBe("New chat");
  });

  it("starts fresh when localStorage holds corrupt JSON", async () => {
    localStorage.setItem("onebrain.chat.threads", "{corrupt");
    const { threads } = await import("./chat-store");
    expect(threads.value.length).toBe(1);
    expect(threads.value[0].title).toBe("New chat");
  });
});

// load() runs at module import, so the localStorage seed must be in place BEFORE
// importing chat-store — hence vi.resetModules() + a dynamic import per case.
describe("chat-store load() restore-sanitize", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("clears a stuck streaming flag and drops a trailing empty AI placeholder", async () => {
    localStorage.setItem(
      "onebrain.chat.threads",
      JSON.stringify([
        {
          id: "t",
          title: "x",
          sessionId: "s",
          updatedAt: 0,
          messages: [
            { role: "you", text: "hi" },
            { role: "ai", text: "partial", streaming: true },
            { role: "ai", text: "", streaming: true },
          ],
        },
      ]),
    );
    const { threads } = await import("./chat-store");
    const t = threads.value[0];
    expect(t.messages.length).toBe(2); // trailing empty placeholder dropped
    expect(t.messages.every((m) => !m.streaming)).toBe(true); // flag cleared
    expect(t.messages[1].text).toBe("partial"); // real partial text kept
  });

  it("keeps a normal completed transcript intact", async () => {
    localStorage.setItem(
      "onebrain.chat.threads",
      JSON.stringify([
        { id: "t", title: "x", sessionId: "s", updatedAt: 0, messages: [
          { role: "you", text: "hi" },
          { role: "ai", text: "hello there" },
        ] },
      ]),
    );
    const { threads } = await import("./chat-store");
    expect(threads.value[0].messages.length).toBe(2);
    expect(threads.value[0].messages[1].text).toBe("hello there");
  });
});
