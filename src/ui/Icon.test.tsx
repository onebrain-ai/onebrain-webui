import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { Icon, type IconName } from "./Icon";

// Every entry in PATHS must render an <svg>. This covers the full IconName union
// and exercises every branch in the PATHS record, driving branch coverage to 100%.
const ALL_ICONS: IconName[] = [
  "file",
  "file-plus",
  "folder",
  "folder-plus",
  "search",
  "tasks",
  "chat",
  "settings",
  "book",
  "code",
  "dots",
  "send",
  "history",
  "edit",
  "trash",
  "plus",
  "x",
  "chevron-right",
  "chevron-down",
  "heading",
  "tag",
  "calendar",
  "calendar-plus",
  "hash",
  "clock",
  "sparkles",
  "user",
  "robot",
  "activity",
  "check",
  "alert",
  "panel-left",
  "refresh",
  "image",
  "download",
  "minus",
  "maximize",
  "paperclip",
  "arrow-left",
  "arrow-right",
  "expand-h",
  "shrink-h",
  "play",
  "copy",
  "contrast",
  "info",
];

describe("Icon", () => {
  it.each(ALL_ICONS)('renders an <svg> for icon "%s"', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // Every icon uses currentColor stroke and aria-hidden (screen-reader safe).
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("stroke")).toBe("currentColor");
  });

  it("applies the ic class by default", () => {
    const { container } = render(<Icon name="file" />);
    // SVGAnimatedString in jsdom — use getAttribute, not .className
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("ic");
  });

  it("merges an extra class with the ic class", () => {
    const { container } = render(<Icon name="file" class="my-icon" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toBe("ic my-icon");
  });

  it("no extra class keeps just the ic class", () => {
    const { container } = render(<Icon name="search" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toBe("ic");
  });

  it("strokeWidth prop is reflected as stroke-width attribute", () => {
    const { container } = render(<Icon name="file" strokeWidth={2} />);
    expect(container.querySelector("svg")!.getAttribute("stroke-width")).toBe("2");
  });

  it("default strokeWidth is 1.5", () => {
    const { container } = render(<Icon name="file" />);
    expect(container.querySelector("svg")!.getAttribute("stroke-width")).toBe("1.5");
  });
});
