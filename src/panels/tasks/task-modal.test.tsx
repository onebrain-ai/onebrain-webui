// Tests for TaskModalHost and openTaskModal().
// TaskModalHost is driven by calling openTaskModal() which sets the module-
// level `active` signal. We verify UI state and modal resolution.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/preact";

import { TaskModalHost, openTaskModal } from "./task-modal";

// ---------------------------------------------------------------------------
// Ensure any leaked open modal is always cancelled after each test so the
// next test starts with a clean slate.
// ---------------------------------------------------------------------------
afterEach(async () => {
  const backdrop = document.querySelector(".ob-modal-backdrop");
  if (backdrop) {
    // Fire Escape on document.body (bubbles to document) to resolve + close the modal
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".ob-modal-backdrop")).toBeNull(), { timeout: 1000 }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILES = ["01-projects/note.md", "02-areas/work.md"];
const FILLED_DRAFT = { text: "Fix the thing", due: "2026-07-15", priority: "high" as const };
const EMPTY_DRAFT = { text: "", due: "2026-07-01", priority: "none" as const };

// Open the modal and wait for it to appear. Returns the pending promise.
async function openModal(opts: Parameters<typeof openTaskModal>[0]) {
  const promise = openTaskModal(opts);
  await waitFor(() => expect(screen.getByTestId("task-modal")).toBeTruthy());
  return promise;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskModalHost — not mounted / no active modal", () => {
  it("renders nothing when no modal is open", () => {
    render(<TaskModalHost />);
    expect(document.querySelector("[data-testid='task-modal']")).toBeNull();
  });
});

describe("openTaskModal — modal structure", () => {
  it("shows the modal title and ok label", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "New task", okLabel: "Add", draft: EMPTY_DRAFT, files: FILES });
    await waitFor(() => expect(screen.getByText("New task")).toBeTruthy());
    expect(screen.getByText("Add")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("okLabel defaults to 'Save' when not provided", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "Edit", draft: FILLED_DRAFT });
    await waitFor(() => screen.getByTestId("task-modal"));
    expect(screen.getByText("Save")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("shows a note picker (datalist + input) in add mode", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
    await waitFor(() => screen.getByPlaceholderText(/pick a project/i));
    const datalist = document.querySelector("#tm-notes") as HTMLDataListElement;
    expect(datalist).toBeTruthy();
    expect(datalist.querySelectorAll("option").length).toBe(2);
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("does NOT show the note picker in edit mode (no files)", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "Edit task", draft: FILLED_DRAFT });
    await waitFor(() => screen.getByTestId("task-modal"));
    expect(screen.queryByPlaceholderText(/pick a project/i)).toBeNull();
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });
});

describe("openTaskModal — pre-filled field values", () => {
  it("pre-fills the task text with draft.text", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "Edit task", draft: FILLED_DRAFT });
    // Wait for the useEffect to run and set the signal (modal shows first, then effect fires)
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("Fix the thing");
    });
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("pre-fills the due date with draft.due", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "Edit task", draft: FILLED_DRAFT });
    await waitFor(() => {
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput.value).toBe("2026-07-15");
    });
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("pre-fills the priority select with draft.priority", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "Edit task", draft: FILLED_DRAFT });
    // Wait for the useEffect to populate the signal
    await waitFor(() => {
      const sel = document.querySelector("select") as HTMLSelectElement;
      expect(sel.value).toBe("high");
    });
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("pre-fills the note picker with files[0] when draft.file is undefined", async () => {
    // file.value = m.draft.file ?? m.files?.[0] ?? ""
    // Undefined triggers the ?? fallback to files[0].
    render(<TaskModalHost />);
    const p = openModal({
      title: "New task",
      draft: { text: "", due: null, priority: "none" }, // no file key → undefined
      files: FILES,
    });
    await waitFor(() => screen.getByPlaceholderText(/pick a project/i));
    // Wait for useEffect to run and set file signal
    await waitFor(() => {
      const noteInput = screen.getByPlaceholderText(/pick a project/i) as HTMLInputElement;
      expect(noteInput.value).toBe("01-projects/note.md");
    });
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("uses empty string when draft.file is '' (string empty — ?? doesn't fall back)", async () => {
    // "" is not null/undefined — ?? does NOT fire; note picker starts empty.
    render(<TaskModalHost />);
    const p = openModal({ title: "New task", draft: { ...EMPTY_DRAFT, file: "" }, files: FILES });
    await waitFor(() => screen.getByPlaceholderText(/pick a project/i));
    const noteInput = screen.getByPlaceholderText(/pick a project/i) as HTMLInputElement;
    expect(noteInput.value).toBe("");
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("uses draft.file when it is explicitly set", async () => {
    render(<TaskModalHost />);
    const p = openModal({
      title: "New task",
      draft: { text: "", due: null, priority: "none", file: "02-areas/work.md" },
      files: FILES,
    });
    await waitFor(() => screen.getByPlaceholderText(/pick a project/i));
    await waitFor(() => {
      const noteInput = screen.getByPlaceholderText(/pick a project/i) as HTMLInputElement;
      expect(noteInput.value).toBe("02-areas/work.md");
    });
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });
});

describe("openTaskModal — Cancel / close paths", () => {
  it("Cancel button resolves null", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
    await waitFor(() => screen.getByTestId("task-modal"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(await promise).toBeNull();
  });

  it("clicking the backdrop (not the dialog) resolves null", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
    await waitFor(() => screen.getByTestId("task-modal"));
    const backdrop = document.querySelector(".ob-modal-backdrop") as HTMLElement;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(await promise).toBeNull();
  });

  it("clicking inside the dialog does NOT close the modal", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
    await waitFor(() => screen.getByTestId("task-modal"));
    fireEvent.mouseDown(screen.getByTestId("task-modal"));
    // Modal still visible
    expect(screen.getByTestId("task-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("Tab key in a dialog triggers trapFocus (does not close modal)", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
    await waitFor(() => screen.getByTestId("task-modal"));
    // Tab should trigger trapFocus — modal stays open.
    const taskInput = screen.getByPlaceholderText(/what needs doing/i);
    fireEvent.keyDown(taskInput, { key: "Tab" });
    expect(screen.getByTestId("task-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("Tab key registered by useEffect calls trapFocus (modal stays open)", async () => {
    render(<TaskModalHost />);
    let p!: Promise<any>;
    // Wrap in act so the useEffect (which registers the keydown listener) runs first
    await act(async () => {
      p = openTaskModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
    });
    await waitFor(() => screen.getByTestId("task-modal"));
    // Fire Tab on document.body — bubbles up to document, hitting the useEffect onKey handler
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Tab" });
    });
    // Modal should still be open (Tab does not close it)
    expect(screen.getByTestId("task-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("Escape key registered by useEffect resolves null (using act flush)", async () => {
    render(<TaskModalHost />);
    let promise!: Promise<any>;
    // Wrap openTaskModal in act so the signal update + useEffect runs synchronously
    await act(async () => {
      promise = openTaskModal({ title: "New task", draft: EMPTY_DRAFT, files: FILES });
      // Give the effect time to register the keydown listener
    });
    await waitFor(() => screen.getByTestId("task-modal"));
    // Now dispatch Escape — the listener should be registered by now
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    const result = await Promise.race([
      promise,
      new Promise<string>((_, rej) => setTimeout(() => rej("timeout"), 2000)),
    ]);
    expect(result).toBeNull();
  }, 10000);
});

describe("openTaskModal — OK / submit paths", () => {
  it("OK with valid text + file resolves with the draft", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({
      title: "New task",
      draft: { text: "Buy milk", due: "2026-07-01", priority: "none", file: "01-projects/note.md" },
      files: FILES,
    });
    // Wait for useEffect to populate the text signal before clicking OK
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("Buy milk");
    });
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Buy milk");
    expect(result!.file).toBe("01-projects/note.md");
    expect(result!.due).toBe("2026-07-01");
  });

  it("OK in edit mode (no files) resolves without the file field", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "Edit task", draft: FILLED_DRAFT });
    // Wait for useEffect to populate text signal before clicking OK
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("Fix the thing");
    });
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result!.text).toBe("Fix the thing");
    expect(result!.file).toBeUndefined();
  });

  it("Enter key on the task input triggers onOk when text is valid", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({
      title: "Edit task",
      draft: { text: "Do laundry", due: null, priority: "none", file: "01-projects/note.md" },
      files: FILES,
    });
    // Wait for useEffect to populate text signal
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("Do laundry");
    });
    const taskInput = screen.getByPlaceholderText(/what needs doing/i);
    fireEvent.keyDown(taskInput, { key: "Enter" });
    const result = await promise;
    expect(result!.text).toBe("Do laundry");
  });

  it("OK with empty text does NOT resolve (validation guard)", async () => {
    let resolved = false;
    render(<TaskModalHost />);
    const promise = openTaskModal({
      title: "New task",
      draft: { text: "", due: null, priority: "none", file: "01-projects/note.md" },
      files: FILES,
    });
    promise.then(() => { resolved = true; });
    await waitFor(() => screen.getByTestId("task-modal"));
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    // Clean up
    fireEvent.click(screen.getByText("Cancel"));
    await promise;
  });

  it("OK with empty file (add mode) does NOT resolve (line 96 validation guard)", async () => {
    // `draft.file: ""` is falsy-but-not-null so `?? files[0]` won't fire;
    // file.value stays "". With text filled in, the first guard passes,
    // and line 96 `if (m.files && !file.value.trim()) return` fires.
    let resolved = false;
    render(<TaskModalHost />);
    const promise = openTaskModal({
      title: "New task",
      draft: { text: "something", due: null, priority: "none", file: "" },
      files: FILES,
    });
    promise.then(() => { resolved = true; });
    // Wait for useEffect to populate text; file remains ""
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("something");
    });
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    fireEvent.click(screen.getByText("Cancel"));
    await promise;
  });
});

// Helper: set an input element's value and dispatch the input event so that
// Preact signal-controlled components pick up the change.
// fireEvent.input({ target: { value } }) assigns value to the element via
// Object.assign before dispatch, which triggers the onInput handler that reads
// e.target.value. This is the standard @testing-library/dom approach.
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  // Use the native input value setter to bypass any property descriptor that
  // might prevent direct assignment on a controlled input.
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeInputValueSetter?.call(el, value);
  fireEvent.input(el, { bubbles: true });
}

function setNativeSelectValue(el: HTMLSelectElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  nativeInputValueSetter?.call(el, value);
  fireEvent.change(el, { bubbles: true });
}

describe("openTaskModal — field change interactions", () => {
  it("editing the task text is reflected in the resolved result", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "Edit task", draft: FILLED_DRAFT });
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("Fix the thing");
    });
    const taskInput = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
    setNativeValue(taskInput, "Updated text");
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result!.text).toBe("Updated text");
  });

  it("editing the due date is reflected in the resolved result", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "Edit task", draft: FILLED_DRAFT });
    await waitFor(() => {
      const di = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(di.value).toBe("2026-07-15");
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    setNativeValue(dateInput, "2026-09-01");
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result!.due).toBe("2026-09-01");
  });

  it("clearing the due date produces null in the resolved result", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "Edit task", draft: FILLED_DRAFT });
    await waitFor(() => {
      const di = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(di.value).toBe("2026-07-15");
    });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    setNativeValue(dateInput, "");
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result!.due).toBeNull();
  });

  it("changing the priority select is reflected in the resolved result", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({ title: "Edit task", draft: { ...FILLED_DRAFT, priority: "none" } });
    await waitFor(() => screen.getByTestId("task-modal"));
    // Wait for useEffect to populate signals
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/what needs doing/i) as HTMLInputElement;
      expect(input.value).toBe("Fix the thing");
    });
    const sel = document.querySelector("select") as HTMLSelectElement;
    setNativeSelectValue(sel, "medium");
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result!.priority).toBe("medium");
  });

  it("all four priority options are rendered", async () => {
    render(<TaskModalHost />);
    const p = openModal({ title: "Edit", draft: FILLED_DRAFT });
    await waitFor(() => screen.getByTestId("task-modal"));
    const sel = document.querySelector("select") as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("none");
    expect(opts).toContain("high");
    expect(opts).toContain("medium");
    expect(opts).toContain("low");
    fireEvent.click(screen.getByText("Cancel"));
    await p;
  });

  it("editing the note picker input is reflected in the resolved result", async () => {
    render(<TaskModalHost />);
    const promise = openTaskModal({
      title: "New task",
      draft: { text: "X", due: null, priority: "none", file: "01-projects/note.md" },
      files: FILES,
    });
    await waitFor(() => screen.getByPlaceholderText(/pick a project/i));
    await waitFor(() => {
      const ni = screen.getByPlaceholderText(/pick a project/i) as HTMLInputElement;
      expect(ni.value).toBe("01-projects/note.md");
    });
    const noteInput = screen.getByPlaceholderText(/pick a project/i) as HTMLInputElement;
    setNativeValue(noteInput, "02-areas/work.md");
    fireEvent.click(screen.getByTestId("task-modal-ok"));
    const result = await promise;
    expect(result!.file).toBe("02-areas/work.md");
  });
});
