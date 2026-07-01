import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { signal } from "@preact/signals";
import { filesPanel } from "./files";
import type { PanelContext } from "../contract";

// Stub heavy sub-panels; we only care about files.tsx's own logic here.
vi.mock("../explorer/explorer", () => ({
  ExplorerTree: () => <div data-testid="explorer-tree" />,
}));

vi.mock("../preview/preview", () => ({
  PreviewBody: () => <div data-testid="preview-body" />,
  // previewExt is a module-level signal read by Files header
  previewExt: signal(".md"),
}));

const ctx: PanelContext = {
  daemon: {} as any,
  openFile: vi.fn(),
  addPanel: vi.fn(),
};

const { Component: Files } = filesPanel;

describe("Files panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the header with the pill and previewExt", () => {
    render(<Files ctx={ctx} />);
    expect(screen.getByText(/Vault · Browser/)).toBeTruthy();
    // previewExt stub value is ".md"
    expect(screen.getByText(".md")).toBeTruthy();
  });

  it("renders ExplorerTree and PreviewBody sub-panels", () => {
    render(<Files ctx={ctx} />);
    expect(screen.getByTestId("explorer-tree")).toBeTruthy();
    expect(screen.getByTestId("preview-body")).toBeTruthy();
  });

  it("tree is visible by default (no tree-hidden class)", () => {
    const { container } = render(<Files ctx={ctx} />);
    const body = container.querySelector(".fb-body");
    expect(body?.className).not.toContain("tree-hidden");
  });

  it("toggle button hides the tree on first click", () => {
    const { container } = render(<Files ctx={ctx} />);
    const btn = screen.getByRole("button", { name: "Toggle file tree" });

    // starts open — aria-pressed="true"
    expect(btn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(btn);

    const body = container.querySelector(".fb-body");
    expect(body?.className).toContain("tree-hidden");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("second click on toggle reopens the tree", () => {
    const { container } = render(<Files ctx={ctx} />);
    const btn = screen.getByRole("button", { name: "Toggle file tree" });

    fireEvent.click(btn); // close
    fireEvent.click(btn); // reopen

    const body = container.querySelector(".fb-body");
    expect(body?.className).not.toContain("tree-hidden");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
