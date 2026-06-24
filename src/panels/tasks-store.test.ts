import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tasks,
  toggleTask,
  editTask,
  deleteTask,
  addTask,
  taskDescription,
  taskPriority,
  type VaultTask,
} from "./tasks-store";

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

describe("task line helpers", () => {
  it("taskDescription strips date + priority markers but keeps #tags", () => {
    expect(taskDescription("ship it 🔺 📅 2026-06-01 #proj")).toBe("ship it #proj");
    expect(taskDescription("plain")).toBe("plain");
  });
  it("taskPriority reads the marker", () => {
    expect(taskPriority("x 🔺")).toBe("high");
    expect(taskPriority("x ⏫")).toBe("medium");
    expect(taskPriority("x 🔽")).toBe("low");
    expect(taskPriority("x")).toBe("none");
  });
});

describe("editTask / deleteTask / addTask write-back", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("editTask rewrites text + priority + due on the matching line", async () => {
    const t = task();
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    const ok = await editTask(daemon, t, { text: "task one done right", due: "2026-07-15", priority: "high" });
    expect(ok).toBe(true);
    expect(saved).toBe("- [ ] task one done right 🔺 📅 2026-07-15");
  });

  it("editTask can clear the due date + priority", async () => {
    const t = task();
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    await editTask(daemon, t, { text: "task one", due: null, priority: "none" });
    expect(saved).toBe("- [ ] task one");
  });

  it("deleteTask removes the line (and only that line)", async () => {
    const t = task({ line: 1 });
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01\nkeep me", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    const ok = await deleteTask(daemon, t);
    expect(ok).toBe(true);
    expect(saved).toBe("keep me");
  });

  it("addTask appends a dated task line to the note", async () => {
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "n.md", content: "# Note", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "n.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    const ok = await addTask(daemon, "n.md", { text: "new task", due: "2026-08-01", priority: "low" });
    expect(ok).toBe(true);
    expect(saved).toBe("# Note\n- [ ] new task 🔽 📅 2026-08-01\n");
  });
});
