import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { ConflictToast } from "./ConflictToast";
import { saveStatus } from "../../core/autosave";

afterEach(() => { saveStatus.value = "idle"; });

describe("ConflictToast", () => {
  it("is hidden unless saveStatus is conflict", () => {
    saveStatus.value = "saved";
    const { container } = render(<ConflictToast onReload={() => {}} onOverwrite={() => {}} />);
    expect(container.querySelector('[data-testid="cms-conflict"]')).toBeNull();
  });

  it("offers reload/overwrite on conflict and fires the callbacks", () => {
    saveStatus.value = "conflict";
    const onReload = vi.fn(), onOverwrite = vi.fn();
    render(<ConflictToast onReload={onReload} onOverwrite={onOverwrite} />);
    fireEvent.click(screen.getByText(/Overwrite/));
    expect(onOverwrite).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Reload/));
    expect(onReload).toHaveBeenCalled();
  });
});
