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
