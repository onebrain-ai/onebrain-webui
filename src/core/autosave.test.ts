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
});
