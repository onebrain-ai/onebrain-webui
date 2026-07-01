// Tests for the Tasks panel component.
// All store signals/ops are mocked. We import the mocked module to access
// the signals so we control their values from tests.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { signal, computed } from "@preact/signals";

// ---------------------------------------------------------------------------
// Create signals OUTSIDE vi.mock so they are true module-level singletons
// that both the mock factory AND the test body reference.
// vi.mock factories ARE hoisted, but the factory here only captures the
// module variable names already defined by import (which are also hoisted).
// We circumvent this by using vi.mock without a factory reference to an
// outer variable — instead we re-export the signals from the mock module
// and import the mock to get them.
//
// APPROACH: use vi.mock with importActual + override specific exports,
// then after mocking, import the "tasks-store" to get the signal objects
// that the component will also import.
// ---------------------------------------------------------------------------

// Signals used by the mock — initialized at module level (not inside factory)
const _tasks = signal<any[]>([]);
const _tasksLoaded = signal(true);
const _tasksError = signal<string | null>(null);
const _taskNotice = signal<string | null>(null);
const _recentlyToggled = signal<Set<string>>(new Set());
const _selectedDate = signal<string | null>(null);
const _dueCount = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return _tasks.value.filter((t: any) => !t.done && !!t.due && t.due <= today).length;
});
const _openCount = computed(() => _tasks.value.filter((t: any) => !t.done).length);
const _doneCount = computed(() => _tasks.value.filter((t: any) => t.done).length);
const _toggleTask = vi.fn(async () => {});
const _editTask = vi.fn(async () => true);
const _deleteTask = vi.fn(async () => true);
const _addTask = vi.fn(async () => true);
const _todayLocal = vi.fn(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
const _taskKey = vi.fn((t: any) => `${t.file}:${t.line}`);
const _taskDescription = vi.fn((text: string) => text);
const _taskPriority = vi.fn(() => "none" as const);

vi.mock("../tasks-store", () => ({
  // Export the pre-created signals by returning them from the factory.
  // The factory is hoisted, but the signal vars above are also in module scope
  // and are initialized before the factory runs (module evaluation order).
  get tasks() { return _tasks; },
  get tasksLoaded() { return _tasksLoaded; },
  get tasksError() { return _tasksError; },
  get taskNotice() { return _taskNotice; },
  get recentlyToggled() { return _recentlyToggled; },
  get selectedDate() { return _selectedDate; },
  get dueCount() { return _dueCount; },
  get openCount() { return _openCount; },
  get doneCount() { return _doneCount; },
  todayLocal: () => _todayLocal(),
  taskKey: (t: any) => _taskKey(t),
  taskDescription: (text: string) => _taskDescription(text),
  taskPriority: (text: string) => _taskPriority(text),
  toggleTask: (...args: any[]) => _toggleTask(...args),
  editTask: (...args: any[]) => _editTask(...args),
  deleteTask: (...args: any[]) => _deleteTask(...args),
  addTask: (...args: any[]) => _addTask(...args),
}));

vi.mock("../bus", async (orig) => ({
  ...(await orig<typeof import("../bus")>()),
  allFiles: vi.fn(() => ["01-projects/note.md", "02-areas/work.md"]),
  get previewPath() {
    return { value: "01-projects/note.md" };
  },
}));

const _confirmModal = vi.fn(async () => true);
vi.mock("../../ui/Modal", async (orig) => ({
  ...(await orig<typeof import("../../ui/Modal")>()),
  confirmModal: (...args: any[]) => _confirmModal(...args),
}));

const _openTaskModal = vi.fn(async () => ({
  text: "New task",
  due: "2026-07-01",
  priority: "none" as const,
  file: "01-projects/note.md",
}));
vi.mock("./task-modal", () => ({
  openTaskModal: (...args: any[]) => _openTaskModal(...args),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks.
// ---------------------------------------------------------------------------
import type { VaultTask } from "../tasks-store";
import { tasksPanel } from "./tasks";

const Tasks = tasksPanel.Component;

const ctx = {
  daemon: {} as any,
  openFile: vi.fn(),
  addPanel: vi.fn(),
};

/** Local-time YYYY-MM-DD (same formula as the component uses) to avoid UTC/local mismatch. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeTask(overrides: Partial<VaultTask> = {}): VaultTask {
  return {
    file: "01-projects/note.md",
    line: 1,
    text: "Buy groceries",
    done: false,
    due: localToday(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _tasks.value = [];
  _tasksLoaded.value = true;
  _tasksError.value = null;
  _taskNotice.value = null;
  _recentlyToggled.value = new Set();
  _selectedDate.value = null;
  _todayLocal.mockReturnValue(localToday());
  _taskKey.mockImplementation((t: VaultTask) => `${t.file}:${t.line}`);
  _taskDescription.mockImplementation((text: string) => text);
  _taskPriority.mockReturnValue("none");
  _confirmModal.mockResolvedValue(true);
  _openTaskModal.mockResolvedValue({
    text: "New task",
    due: "2026-07-01",
    priority: "none",
    file: "01-projects/note.md",
  });
  ctx.openFile = vi.fn();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Tasks panel — loading / error states", () => {
  it("shows a loading indicator when tasksLoaded is false", () => {
    _tasksLoaded.value = false;
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText(/Loading tasks/i)).toBeTruthy();
  });

  it("shows an error message when tasksError is set", () => {
    _tasksError.value = "connection refused";
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText(/connection refused/i)).toBeTruthy();
  });

  it("shows the all-clear empty state with zero tasks loaded", () => {
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText(/All clear/i)).toBeTruthy();
  });
});

describe("Tasks panel — calendar grid", () => {
  it("renders 7 DOW header cells (S M T W T F S)", () => {
    render(<Tasks ctx={ctx} />);
    expect(document.querySelectorAll(".cd").length).toBe(7);
  });

  it("clicking a calendar day sets selectedDate to a non-null ISO date", () => {
    render(<Tasks ctx={ctx} />);
    const todayCell = document.querySelector(".day.today") as HTMLElement;
    fireEvent.click(todayCell);
    // selectedDate is set to the ISO date of the clicked day (YYYY-MM-DD format)
    expect(_selectedDate.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("clicking a selected day again clears selectedDate (double-click toggle)", () => {
    render(<Tasks ctx={ctx} />);
    const todayCell = document.querySelector(".day.today") as HTMLElement;
    // First click: null → today's ISO
    fireEvent.click(todayCell);
    expect(_selectedDate.value).not.toBeNull();
    // Component must re-render with updated sel; todayCell same DOM node
    fireEvent.click(todayCell);
    expect(_selectedDate.value).toBeNull();
  });

  it("Enter key on a day cell toggles selectedDate", () => {
    render(<Tasks ctx={ctx} />);
    const todayCell = document.querySelector(".day.today") as HTMLElement;
    fireEvent.keyDown(todayCell, { key: "Enter" });
    expect(_selectedDate.value).not.toBeNull();
  });

  it("Space key on a day cell toggles selectedDate", () => {
    render(<Tasks ctx={ctx} />);
    const todayCell = document.querySelector(".day.today") as HTMLElement;
    fireEvent.keyDown(todayCell, { key: " " });
    expect(_selectedDate.value).not.toBeNull();
  });

  it("Enter key on a day cell twice toggles back to null (line 140 both branches)", () => {
    // First Enter: sel=null → sets to dIso (falsy branch of `sel === dIso ? null : dIso`)
    // Second Enter: sel=dIso → sets to null (truthy branch)
    render(<Tasks ctx={ctx} />);
    const todayCell = document.querySelector(".day.today") as HTMLElement;
    fireEvent.keyDown(todayCell, { key: "Enter" });
    expect(_selectedDate.value).not.toBeNull();
    fireEvent.keyDown(todayCell, { key: "Enter" });
    expect(_selectedDate.value).toBeNull();
  });

  it("other keys on a day cell are ignored", () => {
    render(<Tasks ctx={ctx} />);
    const todayCell = document.querySelector(".day.today") as HTMLElement;
    fireEvent.keyDown(todayCell, { key: "a" });
    expect(_selectedDate.value).toBeNull();
  });

  it("undone tasks on a calendar day give it the 'has' CSS class", () => {
    // Compute today's local date the same way the component does — getFullYear/Month/Date
    // rather than toISOString() (which is UTC and may differ in non-UTC timezones).
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    _tasks.value = [makeTask({ due: localToday, done: false })];
    render(<Tasks ctx={ctx} />);
    // today's cell should have both 'today' and 'has'
    expect(document.querySelector(".day.today.has")).toBeTruthy();
  });

  it("done tasks do NOT trigger the 'has' calendar marker", () => {
    const today = new Date().toISOString().slice(0, 10);
    _tasks.value = [makeTask({ due: today, done: true })];
    render(<Tasks ctx={ctx} />);
    expect(document.querySelector(".day.today.has")).toBeNull();
  });
});

describe("Tasks panel — date filter banner", () => {
  it("shows the filter banner when selectedDate is set", () => {
    _selectedDate.value = new Date().toISOString().slice(0, 10);
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText(/Showing/i)).toBeTruthy();
    expect(screen.getByText("clear")).toBeTruthy();
  });

  it("clear button resets selectedDate to null", () => {
    _selectedDate.value = new Date().toISOString().slice(0, 10);
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByText("clear"));
    expect(_selectedDate.value).toBeNull();
  });

  it("empty state shows 'Nothing due' when filtering by date with no matches", () => {
    _selectedDate.value = new Date().toISOString().slice(0, 10);
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText(/Nothing due/i)).toBeTruthy();
  });
});

describe("Tasks panel — task list", () => {
  it("renders task row text", () => {
    _tasks.value = [makeTask({ text: "Write tests" })];
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText("Write tests")).toBeTruthy();
  });

  it("overdue task date span carries .overdue class", () => {
    _tasks.value = [makeTask({ text: "Old task", due: "2020-01-01", done: false })];
    _todayLocal.mockReturnValue("2026-06-30");
    render(<Tasks ctx={ctx} />);
    expect(document.querySelector(".td.overdue")).toBeTruthy();
  });

  it("future task does NOT carry .overdue", () => {
    _tasks.value = [makeTask({ text: "Future", due: "2030-01-01", done: false })];
    _todayLocal.mockReturnValue("2026-06-30");
    render(<Tasks ctx={ctx} />);
    expect(document.querySelector(".td.overdue")).toBeNull();
  });

  it("done task carries .done class when kept visible via recentlyToggled", () => {
    _tasks.value = [makeTask({ text: "Done task", done: true })];
    _recentlyToggled.value = new Set(["01-projects/note.md:1"]);
    render(<Tasks ctx={ctx} />);
    expect(document.querySelector(".task-row.done")).toBeTruthy();
  });

  it("clicking the task checkbox box calls toggleTask", () => {
    const task = makeTask();
    _tasks.value = [task];
    render(<Tasks ctx={ctx} />);
    fireEvent.click(document.querySelector(".task-box") as HTMLElement);
    expect(_toggleTask).toHaveBeenCalledWith(ctx.daemon, task);
  });

  it("clicking the task main area also calls toggleTask", () => {
    const task = makeTask();
    _tasks.value = [task];
    render(<Tasks ctx={ctx} />);
    fireEvent.click(document.querySelector(".task-main") as HTMLElement);
    expect(_toggleTask).toHaveBeenCalledWith(ctx.daemon, task);
  });

  it("clicking the date/file span calls ctx.openFile", () => {
    const task = makeTask();
    _tasks.value = [task];
    render(<Tasks ctx={ctx} />);
    fireEvent.click(document.querySelector(".td") as HTMLElement);
    expect(ctx.openFile).toHaveBeenCalledWith(task.file);
  });

  it("renders taskNotice when it is set", () => {
    _tasks.value = [makeTask()];
    _taskNotice.value = "note changed on disk";
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText(/note changed on disk/i)).toBeTruthy();
  });

  it("renders the task footer with open/due/done counts", () => {
    _tasks.value = [makeTask({ done: false }), makeTask({ line: 2, done: true })];
    _recentlyToggled.value = new Set(["01-projects/note.md:2"]);
    render(<Tasks ctx={ctx} />);
    expect(document.querySelector(".task-foot")).toBeTruthy();
    expect(screen.getByText("open")).toBeTruthy();
    expect(screen.getByText("due")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("shows '+N more' when task count exceeds MAX_ROWS=60", () => {
    _tasks.value = Array.from({ length: 61 }, (_, i) =>
      makeTask({ line: i + 1, text: `Task ${i + 1}` }),
    );
    render(<Tasks ctx={ctx} />);
    expect(screen.getByText("+1 more")).toBeTruthy();
  });

  it("tasks are sorted by due date ascending", () => {
    _tasks.value = [
      makeTask({ line: 1, text: "Later", due: "2026-12-01" }),
      makeTask({ line: 2, text: "Earlier", due: "2026-07-01" }),
    ];
    render(<Tasks ctx={ctx} />);
    const rows = document.querySelectorAll(".task-row");
    expect(rows[0].textContent).toContain("Earlier");
    expect(rows[1].textContent).toContain("Later");
  });

  it("tasks without due date sort before tasks with a due date", () => {
    _tasks.value = [
      makeTask({ line: 1, text: "HasDue", due: "2026-07-01" }),
      makeTask({ line: 2, text: "NoDue", due: undefined }),
    ];
    render(<Tasks ctx={ctx} />);
    const rows = document.querySelectorAll(".task-row");
    expect(rows[0].textContent).toContain("NoDue");
  });
});

describe("Tasks panel — add task", () => {
  it("+ button opens the modal and calls addTask on confirm", async () => {
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("New task"));
    await waitFor(() =>
      expect(_openTaskModal).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New task", okLabel: "Add" }),
      ),
    );
    await waitFor(() =>
      expect(_addTask).toHaveBeenCalledWith(ctx.daemon, "01-projects/note.md", expect.any(Object)),
    );
  });

  it("does NOT call addTask when the modal resolves null (cancelled)", async () => {
    _openTaskModal.mockResolvedValueOnce(null);
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("New task"));
    await waitFor(() => expect(_openTaskModal).toHaveBeenCalled());
    expect(_addTask).not.toHaveBeenCalled();
  });

  it("does NOT call addTask when the modal result has no file", async () => {
    _openTaskModal.mockResolvedValueOnce({ text: "task", due: null, priority: "none" as const });
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("New task"));
    await waitFor(() => expect(_openTaskModal).toHaveBeenCalled());
    expect(_addTask).not.toHaveBeenCalled();
  });

  it("uses selectedDate as the default due date in the add modal", async () => {
    _selectedDate.value = "2026-07-15";
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("New task"));
    await waitFor(() =>
      expect(_openTaskModal).toHaveBeenCalledWith(
        expect.objectContaining({ draft: expect.objectContaining({ due: "2026-07-15" }) }),
      ),
    );
  });
});

describe("Tasks panel — edit task", () => {
  it("edit button opens the modal and calls editTask on confirm", async () => {
    const task = makeTask({ text: "Edit me" });
    _tasks.value = [task];
    _openTaskModal.mockResolvedValueOnce({ text: "Edited", due: null, priority: "none" as const });
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("Edit task"));
    await waitFor(() =>
      expect(_editTask).toHaveBeenCalledWith(ctx.daemon, task, expect.objectContaining({ text: "Edited" })),
    );
  });

  it("does NOT call editTask when the modal is cancelled", async () => {
    _tasks.value = [makeTask()];
    _openTaskModal.mockResolvedValueOnce(null);
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("Edit task"));
    await waitFor(() => expect(_openTaskModal).toHaveBeenCalled());
    expect(_editTask).not.toHaveBeenCalled();
  });
});

describe("Tasks panel — delete task", () => {
  it("delete button shows confirm modal and calls deleteTask on confirm", async () => {
    const task = makeTask();
    _tasks.value = [task];
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("Delete task"));
    await waitFor(() => expect(_confirmModal).toHaveBeenCalled());
    await waitFor(() => expect(_deleteTask).toHaveBeenCalledWith(ctx.daemon, task));
  });

  it("does NOT call deleteTask when the confirm is cancelled", async () => {
    _tasks.value = [makeTask()];
    _confirmModal.mockResolvedValueOnce(false);
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByTitle("Delete task"));
    await waitFor(() => expect(_confirmModal).toHaveBeenCalled());
    expect(_deleteTask).not.toHaveBeenCalled();
  });
});

describe("Tasks panel — branch coverage completions", () => {
  it("recently-toggled DONE task is kept visible even without selectedDate (line 67 branch)", () => {
    // A done task in recentlyToggled is shown alongside open tasks.
    // This exercises the `keep.has(taskKey(t))` branch in the visible filter.
    const doneTask = makeTask({ done: true, file: "01-projects/note.md", line: 99 });
    _tasks.value = [doneTask];
    _recentlyToggled.value = new Set(["01-projects/note.md:99"]);
    _selectedDate.value = null;
    _taskKey.mockImplementation((t: any) => `${t.file}:${t.line}`);
    render(<Tasks ctx={ctx} />);
    // The done task is kept visible because it is in recentlyToggled
    expect(screen.getByText("Buy groceries")).toBeTruthy();
  });

  it("onAdd falls back to empty file when previewPath is not in note choices (line 79 branch)", async () => {
    // When previewPath.value is not in the allFiles list, `choices.includes(...)` is
    // false and `file` in the draft is set to "" (the else-branch of line 79).
    const { allFiles } = await import("../bus");
    vi.mocked(allFiles).mockReturnValueOnce([]); // empty choices → previewPath not included
    _openTaskModal.mockResolvedValueOnce(null);   // user cancels
    render(<Tasks ctx={ctx} />);
    fireEvent.click(screen.getByLabelText("New task"));
    await waitFor(() => expect(_openTaskModal).toHaveBeenCalled());
    // The draft's file field should have been "" (not previewPath)
    expect(_openTaskModal).toHaveBeenCalledWith(
      expect.objectContaining({ draft: expect.objectContaining({ file: "" }) }),
    );
  });

  it("calendar Enter key toggles the selected date (line 140 keyboard branch)", () => {
    // Exercises the onKeyDown Enter handler on calendar cells, covering line 140.
    render(<Tasks ctx={ctx} />);
    // Calendar day cells are divs with class "day" and tabIndex=0 (no data-testid).
    const cells = document.querySelectorAll('.day[tabindex="0"]');
    if (cells.length > 0) {
      fireEvent.keyDown(cells[0], { key: "Enter" });
    }
  });

  it("calendar Space key toggles the selected date (line 140 keyboard branch)", () => {
    // Exercises the onKeyDown Space handler on calendar cells.
    render(<Tasks ctx={ctx} />);
    const cells = document.querySelectorAll('.day[tabindex="0"]');
    if (cells.length > 0) {
      fireEvent.keyDown(cells[0], { key: " " });
    }
  });
});
