import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/preact";
import { ModalHost, promptModal, confirmModal, trapFocus } from "./Modal";

// promptModal/confirmModal set a module-level signal from OUTSIDE a DOM event, so
// wrap them in act() to flush the open effect (which registers the keydown
// listener + seeds the input from the modal's initial value).

describe("Modal promise lifecycle", () => {
  it("Escape resolves a prompt to null", async () => {
    const { findByTestId } = render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "x" });
    });
    await findByTestId("ob-modal");
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBeNull();
  });

  it("Escape resolves a confirm to false", async () => {
    const { findByTestId } = render(<ModalHost />);
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmModal({ title: "x" });
    });
    await findByTestId("ob-modal");
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBe(false);
  });

  it("OK resolves a prompt with the (trimmed) value, exactly once", async () => {
    const spy = vi.fn();
    const { findByTestId, queryByTestId } = render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "x", value: "  hello  " }); // seed avoids an input-event race
    });
    p.then(spy);
    fireEvent.click(await findByTestId("ob-modal-ok"));
    await expect(p).resolves.toBe("hello");
    expect(queryByTestId("ob-modal")).toBeNull(); // closed
    expect(spy).toHaveBeenCalledTimes(1); // resolved once
  });

  it("Cancel button resolves a prompt to null", async () => {
    render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "cancel-test" });
    });
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByText("Cancel"));
    await expect(p).resolves.toBeNull();
  });

  it("Cancel button resolves a confirm to false", async () => {
    render(<ModalHost />);
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmModal({ title: "confirm-cancel" });
    });
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByText("Cancel"));
    await expect(p).resolves.toBe(false);
  });

  it("OK resolves a confirm to true", async () => {
    render(<ModalHost />);
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmModal({ title: "confirm-ok", okLabel: "Yes" });
    });
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await expect(p).resolves.toBe(true);
  });

  it("danger confirm renders the ok button with danger class", async () => {
    render(<ModalHost />);
    await act(async () => {
      void confirmModal({ title: "danger!", danger: true, okLabel: "Delete" });
    });
    await screen.findByTestId("ob-modal");
    expect(screen.getByTestId("ob-modal-ok").className).toContain("danger");
  });

  it("message text is rendered inside the modal", async () => {
    render(<ModalHost />);
    await act(async () => {
      void confirmModal({ title: "t", message: "Are you sure?" });
    });
    await screen.findByTestId("ob-modal");
    expect(screen.getByText("Are you sure?")).toBeTruthy();
  });

  it("backdrop mousedown on backdrop element cancels the modal", async () => {
    render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "backdrop-test" });
    });
    await screen.findByTestId("ob-modal");
    const backdrop = document.querySelector(".ob-modal-backdrop") as HTMLElement;
    // Simulate click where target === currentTarget (the backdrop itself).
    fireEvent.mouseDown(backdrop, { target: backdrop });
    await expect(p).resolves.toBeNull();
  });

  it("Enter key inside prompt input resolves the modal", async () => {
    render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "enter-test", value: "hello" });
    });
    const input = await screen.findByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(p).resolves.toBe("hello");
  });

  it("Tab key inside modal triggers trapFocus (no error)", async () => {
    render(<ModalHost />);
    await act(async () => {
      void promptModal({ title: "tab-test" });
    });
    await screen.findByTestId("ob-modal");
    // Should not throw — trapFocus wraps focus within the dialog.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("ob-modal")).toBeTruthy();
  });

  it("input onInput event updates the resolved value", async () => {
    render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "input-test" });
    });
    const input = await screen.findByRole("textbox");
    fireEvent.input(input, { target: { value: "typed" } });
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await expect(p).resolves.toBe("typed");
  });

  it("backdrop mousedown on inner element does NOT cancel the modal", async () => {
    // Exercises the false branch of `if (e.target === e.currentTarget)` at line 113.
    render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "inner-click" });
    });
    await screen.findByTestId("ob-modal");
    // Click on the inner dialog div — should NOT resolve/cancel.
    const dialog = screen.getByTestId("ob-modal");
    fireEvent.mouseDown(dialog);
    // Give any async resolution a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    // Modal should still be present (not cancelled).
    expect(screen.getByTestId("ob-modal")).toBeTruthy();
    // Clean up by pressing Escape.
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBeNull();
  });

  it("non-Enter keydown on input does NOT resolve the modal", async () => {
    // Exercises the false branch of `if (e.key === "Enter")` at line 127.
    render(<ModalHost />);
    let p!: Promise<string | null>;
    await act(async () => {
      p = promptModal({ title: "non-enter-test", value: "hello" });
    });
    const input = await screen.findByRole("textbox");
    // Arrow-Down is not Enter → should NOT resolve.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("ob-modal")).toBeTruthy();
    // Clean up.
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBeNull();
  });
});

describe("trapFocus", () => {
  it("does nothing when container is null", () => {
    // Should not throw.
    trapFocus(new KeyboardEvent("keydown"), null);
  });

  it("does nothing when container has no focusable items", () => {
    const div = document.createElement("div");
    // No focusable children → items.length === 0 → early return.
    trapFocus(new KeyboardEvent("keydown"), div);
  });

  it("wraps focus forward (Tab on last item → first item)", () => {
    const div = document.createElement("div");
    const b1 = document.createElement("button");
    const b2 = document.createElement("button");
    div.appendChild(b1);
    div.appendChild(b2);
    document.body.appendChild(div);
    b2.focus(); // active element is the last item
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    Object.defineProperty(e, "shiftKey", { value: false });
    trapFocus(e, div);
    // focus should jump to b1
    expect(document.activeElement).toBe(b1);
    document.body.removeChild(div);
  });

  it("wraps focus backward (Shift+Tab on first item → last item)", () => {
    const div = document.createElement("div");
    const b1 = document.createElement("button");
    const b2 = document.createElement("button");
    div.appendChild(b1);
    div.appendChild(b2);
    document.body.appendChild(div);
    b1.focus(); // active element is the first item
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    Object.defineProperty(e, "shiftKey", { value: true });
    trapFocus(e, div);
    expect(document.activeElement).toBe(b2);
    document.body.removeChild(div);
  });
});
