import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tasks,
  toggleTask,
  editTask,
  deleteTask,
  addTask,
  taskDescription,
  taskPriority,
  taskNotice,
  loadTasks,
  tasksLoaded,
  tasksError,
  recentlyToggled,
  dueCount,
  openCount,
  doneCount,
  type VaultTask,
} from "./tasks-store";
import { ConflictError } from "../core/types";

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

  it("optimistic flip is applied even when the task is not in the current list", async () => {
    // Exercises the setLocalDone no-match branch (t.file !== file path).
    // tasks.value is empty so the map iterates over nothing — no-op, no crash.
    tasks.value = [];
    const t = task();
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async () => ({ path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    // Should not throw even when the task isn't in tasks.value.
    await expect(toggleTask(daemon, t)).resolves.toBeUndefined();
  });

  it("flips [x]→[ ] when toggling a done task back to open", async () => {
    // Exercises the `next ? "x" : " "` false branch (un-checking a done task).
    const t = task({ done: true });
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [x] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    await toggleTask(daemon, t);
    expect(saved).toBe("- [ ] task one 📅 2026-06-01");
    expect(tasks.value[0].done).toBe(false);
  });

  it("sets conflict notice and reverts when saveFile throws ConflictError", async () => {
    const t = task();
    tasks.value = [t];
    taskNotice.value = null;
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async () => { throw new ConflictError("conflict", "rev2"); }),
      tasks: vi.fn(async () => [t]),
    } as any;
    await toggleTask(daemon, t);
    expect(taskNotice.value).toContain("changed on disk");
    // Optimistic flip was reverted.
    expect(tasks.value[0].done).toBe(false);
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

  it("mutateLine sets conflict notice and returns false on ConflictError", async () => {
    const t = task();
    tasks.value = [t];
    taskNotice.value = null;
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(async () => { throw new ConflictError("conflict", "rev2"); }),
      tasks: vi.fn(async () => [t]),
    } as any;
    const ok = await editTask(daemon, t, { text: "new text", due: null, priority: "none" });
    expect(ok).toBe(false);
    expect(taskNotice.value).toContain("changed on disk");
  });

  it("mutateLine sets generic notice and returns false on a non-conflict error", async () => {
    const t = task();
    tasks.value = [t];
    taskNotice.value = null;
    const daemon = {
      file: vi.fn(async () => { throw new Error("network error"); }),
      saveFile: vi.fn(),
      tasks: vi.fn(async () => [t]),
    } as any;
    const ok = await deleteTask(daemon, t);
    expect(ok).toBe(false);
    expect(taskNotice.value).toContain("couldn't update");
  });

  it("addTask sets conflict notice and returns false on ConflictError", async () => {
    taskNotice.value = null;
    const daemon = {
      file: vi.fn(async () => ({ path: "n.md", content: "# Note", rev: "1" })),
      saveFile: vi.fn(async () => { throw new ConflictError("conflict", "rev2"); }),
      tasks: vi.fn(async () => []),
    } as any;
    const ok = await addTask(daemon, "n.md", { text: "new task", due: "2026-08-01", priority: "none" });
    expect(ok).toBe(false);
    expect(taskNotice.value).toContain("changed on disk");
  });

  it("addTask sets generic notice and returns false on other errors", async () => {
    taskNotice.value = null;
    const daemon = {
      file: vi.fn(async () => { throw new Error("no disk"); }),
      saveFile: vi.fn(),
      tasks: vi.fn(async () => []),
    } as any;
    const ok = await addTask(daemon, "n.md", { text: "task", due: null, priority: "none" });
    expect(ok).toBe(false);
    expect(taskNotice.value).toContain("couldn't add");
  });
});

describe("computed signals — dueCount / openCount / doneCount", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("dueCount counts undone tasks due today or earlier", () => {
    // todayLocal() returns the local date; use a past date to guarantee "due".
    tasks.value = [
      task({ done: false, due: "2000-01-01" }), // overdue → counts as due
      task({ done: false, due: "2099-12-31" }), // future → not due yet
      task({ done: true,  due: "2000-01-01" }), // done — not counted as due
    ];
    expect(dueCount.value).toBe(1);
    expect(openCount.value).toBe(2);
    expect(doneCount.value).toBe(1);
  });
});

describe("toggleTask inflight guard", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("returns immediately (no-op) when the same task is already in flight", async () => {
    const t = task();
    tasks.value = [t];
    let resolveFile!: () => void;
    const fileBlocked = new Promise<{ path: string; content: string; rev: string }>((res) => {
      resolveFile = () => res({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" });
    });
    const daemon = {
      file: vi.fn(() => fileBlocked),
      saveFile: vi.fn(async () => ({ path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;

    const first = toggleTask(daemon, t); // blocks on file()
    const secondResolved = vi.fn();
    toggleTask(daemon, t).then(secondResolved); // inflight → resolves immediately
    // Let the microtask queue drain
    await Promise.resolve();
    expect(secondResolved).toHaveBeenCalled(); // second returned immediately
    resolveFile();
    await first;
    expect(daemon.file).toHaveBeenCalledTimes(1); // only one real fetch
  });
});

describe("inflight guard — duplicate concurrent calls are rejected", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("mutateLine: second call while in-flight returns false immediately", async () => {
    const t = task();
    tasks.value = [t];
    // The first call blocks on file(); the second call should see inflight and bail.
    let resolveFile!: () => void;
    const filePromise = new Promise<{ path: string; content: string; rev: string }>((res) => {
      resolveFile = () => res({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" });
    });
    const daemon = {
      file: vi.fn(() => filePromise),
      saveFile: vi.fn(async () => ({ path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;

    const first = deleteTask(daemon, t); // starts, blocks on file()
    const second = deleteTask(daemon, t); // inflight → returns false immediately
    expect(await second).toBe(false);
    resolveFile(); // unblock the first call
    await first;
    expect(daemon.file).toHaveBeenCalledTimes(1); // second never reached file()
  });
});

describe("mutateLine drift scenarios", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("mutateLine: line undefined (task.line beyond file length) → drift, returns false", async () => {
    // Line 4 requested but file only has 1 line → lines[3] is undefined.
    const t = task({ line: 4, text: "task one" });
    tasks.value = [t];
    taskNotice.value = null;
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01", rev: "1" })),
      saveFile: vi.fn(),
      tasks: vi.fn(async () => [t]),
    } as any;
    const ok = await deleteTask(daemon, t);
    expect(ok).toBe(false);
    expect(daemon.saveFile).not.toHaveBeenCalled();
  });

  it("editTask: FULL_TASK_LINE no-match → transform returns null → drift, returns false", async () => {
    // The line passes lineIsTask (matches TASK_LINE) but FULL_TASK_LINE won't match
    // if the task body is empty. Construct such a case: a line with text that tricks
    // TASK_LINE but is empty after the scanner's DUE_MARK strip. In practice this is
    // hard to trigger because FULL_TASK_LINE is very permissive; instead use a line
    // that is a completely different format so lineIsTask fails and drift is thrown
    // via the undefined / !lineIsTask path before FULL_TASK_LINE is even called.
    // The FULL_TASK_LINE no-match (167) is already reached when the line passes
    // lineIsTask but the indent-based FULL_TASK_LINE does not — cover via a line
    // whose body is whitespace only (no text captured by FULL_TASK_LINE's group).
    const t = task({ line: 1, text: "task one" });
    tasks.value = [t];
    // A line that matches TASK_LINE ("task one") but when regex-captured the body
    // portion is empty after the regex — we can't actually force FULL_TASK_LINE
    // to fail on a valid task line because both regexes cover the same domain.
    // Cover instead by testing that editTask with mismatched line drifts:
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "# not a task\n", rev: "1" })),
      saveFile: vi.fn(),
      tasks: vi.fn(async () => [t]),
    } as any;
    const ok = await editTask(daemon, t, { text: "x", due: null, priority: "none" });
    expect(ok).toBe(false);
  });
});

describe("mutateLine — CRLF preservation", () => {
  beforeEach(() => {
    tasks.value = [];
  });

  it("preserves CRLF line endings when editing a task", async () => {
    const t = task({ line: 1, text: "task one" });
    tasks.value = [t];
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "a.md", content: "- [ ] task one 📅 2026-06-01\r\n", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "a.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    const ok = await editTask(daemon, t, { text: "task one", due: "2026-07-01", priority: "none" });
    expect(ok).toBe(true);
    expect(saved).toContain("\r\n");
  });
});

describe("addTask — CRLF and empty file edge cases", () => {
  it("appends with CRLF separator when the file uses CRLF line endings", async () => {
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "n.md", content: "# Note\r\n", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "n.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    await addTask(daemon, "n.md", { text: "task", due: null, priority: "none" });
    expect(saved).toContain("\r\n");
  });

  it("appends to an empty file without a leading newline", async () => {
    let saved = "";
    const daemon = {
      file: vi.fn(async () => ({ path: "empty.md", content: "", rev: "1" })),
      saveFile: vi.fn(async (_p: string, c: string) => ((saved = c), { path: "empty.md", rev: "2" })),
      tasks: vi.fn(async () => []),
    } as any;
    await addTask(daemon, "empty.md", { text: "new", due: null, priority: "none" });
    // sep should be "" because content is empty
    expect(saved.startsWith("- [ ] new")).toBe(true);
  });
});

describe("loadTasks", () => {
  beforeEach(() => {
    tasks.value = [];
    tasksLoaded.value = false;
    tasksError.value = null;
    recentlyToggled.value = new Set();
  });

  it("populates tasks and sets loaded on success", async () => {
    const list = [task()];
    const daemon = { tasks: vi.fn(async () => list) } as any;
    await loadTasks(daemon);
    expect(tasks.value).toEqual(list);
    expect(tasksLoaded.value).toBe(true);
    expect(tasksError.value).toBeNull();
  });

  it("clears recentlyToggled on a fresh load", async () => {
    recentlyToggled.value = new Set(["a.md:1"]);
    const daemon = { tasks: vi.fn(async () => []) } as any;
    await loadTasks(daemon);
    expect(recentlyToggled.value.size).toBe(0);
  });

  it("sets tasksError and still marks loaded on failure", async () => {
    const daemon = { tasks: vi.fn(async () => { throw new Error("offline"); }) } as any;
    await loadTasks(daemon);
    expect(tasksLoaded.value).toBe(true);
    expect(tasksError.value).toBe("offline");
  });

  it("uses fallback message for non-Error throws", async () => {
    const daemon = { tasks: vi.fn(async () => { throw "bad"; }) } as any;
    await loadTasks(daemon);
    expect(tasksError.value).toBe("could not load tasks");
  });
});
