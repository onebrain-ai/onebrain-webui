import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Properties } from "./properties";

describe("Properties", () => {
  it("renders a row per frontmatter key and reports edits", () => {
    const onChange = vi.fn();
    render(<Properties value={{ title: "Hi", tags: ["a", "b"] }} onChange={onChange} />);
    expect(screen.getByDisplayValue("Hi")).toBeTruthy();
    expect(screen.getByDisplayValue("a, b")).toBeTruthy();
    fireEvent.input(screen.getByDisplayValue("Hi"), { target: { value: "Bye" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Bye" }));
  });
});
