import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Properties } from "./properties";
import { propertiesCollapsed } from "../../core/stores";

beforeEach(() => {
  // reset collapse state to default (expanded) between tests
  propertiesCollapsed.value = false;
});

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

  // line 13-14: "name" key → heading icon; "tag" singular → tag icon
  it("renders nothing when the frontmatter object is empty (line 13-14 guard)", () => {
    const onChange = vi.fn();
    const { container } = render(<Properties value={{}} onChange={onChange} />);
    // null return — nothing mounted
    expect(container.firstChild).toBeNull();
  });

  // line 95: collapsed state hides the body but keeps the header
  it("collapses the properties body when propertiesCollapsed is true", () => {
    propertiesCollapsed.value = true;
    const onChange = vi.fn();
    render(<Properties value={{ title: "Hi" }} onChange={onChange} />);
    // the toggle button is always present
    expect(screen.getByTestId("props-toggle")).toBeTruthy();
    // the input is hidden (body not rendered when collapsed)
    expect(screen.queryByDisplayValue("Hi")).toBeNull();
  });

  // toggle the collapsed state via clicking the header button
  it("clicking the props-toggle header flips the collapsed signal", () => {
    propertiesCollapsed.value = false;
    const onChange = vi.fn();
    render(<Properties value={{ title: "Hi" }} onChange={onChange} />);
    // body is initially visible
    expect(screen.getByDisplayValue("Hi")).toBeTruthy();
    // click the toggle — should collapse
    fireEvent.click(screen.getByTestId("props-toggle"));
    expect(propertiesCollapsed.value).toBe(true);
    // body disappears
    expect(screen.queryByDisplayValue("Hi")).toBeNull();
  });

  // date input change fires onChange with the new string value
  it("editing a date input emits the updated date string", () => {
    const onChange = vi.fn();
    render(<Properties value={{ updated: "2025-01-15" }} onChange={onChange} />);
    const input = screen.getByDisplayValue("2025-01-15");
    fireEvent.input(input, { target: { value: "2025-06-30" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ updated: "2025-06-30" }));
  });

  // pressing a non-Enter key in the tag adder must NOT emit onChange
  it("non-Enter keydown in tag adder does not emit onChange", () => {
    const onChange = vi.fn();
    render(<Properties value={{ tags: ["x"] }} onChange={onChange} />);
    const adder = screen.getByPlaceholderText("+ tag");
    fireEvent.input(adder, { target: { value: "y" } });
    fireEvent.keyDown(adder, { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // pressing Enter with an empty/whitespace value must NOT emit onChange
  it("Enter with blank tag input does not emit onChange", () => {
    const onChange = vi.fn();
    render(<Properties value={{ tags: ["x"] }} onChange={onChange} />);
    const adder = screen.getByPlaceholderText("+ tag");
    fireEvent.input(adder, { target: { value: "   " } });
    fireEvent.keyDown(adder, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // generic string field (non-date, non-list) — plain text input
  it("renders a plain text input for a generic string field and reports edits", () => {
    const onChange = vi.fn();
    render(<Properties value={{ author: "Alice" }} onChange={onChange} />);
    const input = screen.getByDisplayValue("Alice");
    fireEvent.input(input, { target: { value: "Bob" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ author: "Bob" }));
  });

  // numeric value coerced to string — should not crash
  it("renders a numeric value coerced to string without error", () => {
    const onChange = vi.fn();
    render(<Properties value={{ priority: 3 }} onChange={onChange} />);
    expect(screen.getByDisplayValue("3")).toBeTruthy();
  });

  // line 100: v ?? "" branch — null/undefined value renders as empty string (not crash)
  it("renders a null value as an empty string input (v ?? '' branch, line 100)", () => {
    const onChange = vi.fn();
    render(<Properties value={{ status: null as any }} onChange={onChange} />);
    // null coerced: String(null ?? "") = "" — renders an empty input
    const input = screen.getByDisplayValue("") as HTMLInputElement;
    expect(input).toBeTruthy();
  });
});
