import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Autosaver, saveStatus, dirty, conflictRev } from "./autosave";
import { ConflictError } from "./types";

const target = (rev: string | null) => ({ path: "a.md", rev, compose: () => "BODY" });

describe("Autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces then PUTs with the current rev, adopts the new rev", async () => {
    const daemon = { saveFile: vi.fn(async () => ({ path: "a.md", rev: "222" })) } as any;
    const t = target("111");
    const a = new Autosaver(daemon, t);
    a.schedule();
    expect(dirty.value).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(daemon.saveFile).toHaveBeenCalledWith("a.md", "BODY", "111");
    expect(t.rev).toBe("222");
    expect(saveStatus.value).toBe("saved");
    expect(dirty.value).toBe(false);
  });

  it("uses createFile when rev is null (new note)", async () => {
    const daemon = { createFile: vi.fn(async () => ({ path: "a.md", rev: "1" })) } as any;
    const a = new Autosaver(daemon, target(null));
    a.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(daemon.createFile).toHaveBeenCalledWith("a.md", "BODY");
  });

  it("surfaces a conflict without auto-resolving", async () => {
    const daemon = { saveFile: vi.fn(async () => { throw new ConflictError("rev mismatch", "999"); }) } as any;
    const a = new Autosaver(daemon, target("111"));
    a.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(saveStatus.value).toBe("conflict");
    expect(conflictRev.value).toBe("999");
  });

  it("overwrite() saves with If-Match * and clears the conflict", async () => {
    const daemon = { saveFile: vi.fn(async () => ({ path: "a.md", rev: "9" })) } as any;
    conflictRev.value = "5";
    saveStatus.value = "conflict";
    const a = new Autosaver(daemon, target("1"));
    await a.overwrite();
    expect(daemon.saveFile).toHaveBeenCalledWith("a.md", "BODY", "*");
    expect(saveStatus.value).toBe("saved");
    expect(conflictRev.value).toBe(null);
  });

  it("adoptRev() updates the target rev", () => {
    const t = target("1");
    const a = new Autosaver({} as any, t);
    a.adoptRev("42");
    expect(t.rev).toBe("42");
  });

  // Line 58 branch: flush() catches a non-ConflictError and sets status="error".
  it("flush() sets status=error for a non-conflict network failure", async () => {
    const daemon = { saveFile: vi.fn(async () => { throw new Error("network down"); }) } as any;
    const a = new Autosaver(daemon, target("1"));
    a.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(saveStatus.value).toBe("error");
    // conflictRev must NOT be set (it stays at whatever it was — null by default from prior tests).
    // Just confirm we're in the error state, not conflict.
    expect(saveStatus.value).not.toBe("conflict");
  });

  // Line 75 branch: overwrite() catches a failure and sets status="error".
  it("overwrite() sets status=error when the server rejects the clobber", async () => {
    const daemon = { saveFile: vi.fn(async () => { throw new Error("server error"); }) } as any;
    const a = new Autosaver(daemon, target("1"));
    await a.overwrite();
    expect(saveStatus.value).toBe("error");
  });

  // Calling schedule() twice rearms the debounce (first timer is cleared).
  it("re-schedule within the debounce window delays the flush", async () => {
    const daemon = { saveFile: vi.fn(async () => ({ path: "a.md", rev: "2" })) } as any;
    const t = target("1");
    const a = new Autosaver(daemon, t);
    a.schedule();
    await vi.advanceTimersByTimeAsync(400); // half the debounce
    a.schedule(); // rearm
    await vi.advanceTimersByTimeAsync(400); // only 400ms since last schedule — no flush yet
    expect(daemon.saveFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400); // now the full 800ms have elapsed
    expect(daemon.saveFile).toHaveBeenCalledTimes(1);
  });

  // flush() called directly (Cmd+S path) cancels a pending debounce timer.
  it("flush() cancels a pending debounce and saves immediately", async () => {
    const daemon = { saveFile: vi.fn(async () => ({ path: "a.md", rev: "3" })) } as any;
    const t = target("2");
    const a = new Autosaver(daemon, t);
    a.schedule(); // arms the debounce
    await a.flush(); // saves immediately, timer cancelled
    expect(daemon.saveFile).toHaveBeenCalledTimes(1);
    // The debounce timer is gone — no second call after the original 800ms.
    await vi.advanceTimersByTimeAsync(800);
    expect(daemon.saveFile).toHaveBeenCalledTimes(1);
  });

  // flush() with no pending timer (timer=null branch at line 39).
  it("flush() without a prior schedule() still saves (timer=null branch)", async () => {
    const daemon = { saveFile: vi.fn(async () => ({ path: "a.md", rev: "5" })) } as any;
    const a = new Autosaver(daemon, target("4"));
    // Call flush() directly — no schedule() means timer is null.
    await a.flush();
    expect(daemon.saveFile).toHaveBeenCalledWith("a.md", "BODY", "4");
    expect(saveStatus.value).toBe("saved");
  });
});
