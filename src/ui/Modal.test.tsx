import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/preact";
import { ModalHost, promptModal, confirmModal } from "./Modal";

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
});
