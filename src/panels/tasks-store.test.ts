import { describe, it, expect, vi, beforeEach } from "vitest";
import { tasks, toggleTask, type VaultTask } from "./tasks-store";

function task(over: Partial<VaultTask> = {}): VaultTask {
  return { file: "a.md", line: 1, text: "task one", done: false, due: "2026-06-01", ...over };
}

describe("toggleTask write-back", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("flips [ ]→[x] in the source note when the line still matches", async () => {
    const t = task();
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    await toggleTask(daemon, t);
    expect(saved).toBe("- [x] task one 📅 2026-06-01");
    expect(tasks.value[0].done).toBe(true);
  });

  it("REJECTS the write (no corruption) when the line drifted to a different task", async () => {
    const t = task({ line: 2 });
    tasks.value = [t];
    const daemon = {
      // line 2 is now a DIFFERENT task than the one clicked
      file: vi.fn(async () => ({ path: "a.md", content: "# h\n- [ ] OTHER task 📅 2026-06-01\n", rev: "1" })),
      saveFile: vi.fn(),
      tasks: vi.fn(async () => [t]),
    } as any;
    await toggleTask(daemon, t);
    expect(daemon.saveFile).not.toHaveBeenCalled(); // never writes the wrong line
    expect(daemon.tasks).toHaveBeenCalled(); // resynced
  });

  it("preserves CRLF line endings (no silent LF flattening)", async () => {
    const t = task({ line: 2, text: "t" });
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "# h\r\n- [ ] t 📅 2026-06-01\r\n", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    await toggleTask(daemon, t);
    expect(saved).toContain("\r\n");
    expect(saved).toContain("- [x] t 📅 2026-06-01");
  });
});
