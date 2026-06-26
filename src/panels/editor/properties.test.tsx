import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Properties } from "./properties";

describe("Properties", () => {
  it("renders a row per frontmatter key and reports edits", () => {
    const onChange = vi.fn();
    render(<Properties value={{ title: "Hi", tags: ["a", "b"] }} onChange={onChange} />);
    expect(screen.getByDisplayValue("Hi")).toBeTruthy();
    // list-valued props render as pills, not a comma-joined input
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    fireEvent.input(screen.getByDisplayValue("Hi"), { target: { value: "Bye" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Bye" }));
  });

  it("renders an ISO-date value as a calendar (date) input", () => {
    const onChange = vi.fn();
    render(<Properties value={{ created: "2026-04-26" }} onChange={onChange} />);
    const input = screen.getByDisplayValue("2026-04-26") as HTMLInputElement;
    expect(input.type).toBe("date");
  });

  it("tag pills add + remove emit the updated list", () => {
    const onChange = vi.fn();
    render(<Properties value={{ tags: ["a", "b"] }} onChange={onChange} />);
    // remove "a"
    fireEvent.click(screen.getByLabelText("Remove a"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ["b"] }));
    // add "c" via the adder
    const adder = screen.getByPlaceholderText("+ tag");
    fireEvent.input(adder, { target: { value: "c" } });
    fireEvent.keyDown(adder, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ["a", "b", "c"] }));
  });
});
