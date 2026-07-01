import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderMathIn } from "./katex";

// Mock katex so the heavy runtime isn't needed in tests. The mock katex.render
// writes a sentinel into the target element so we can confirm it was called.
vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement, opts: { displayMode?: boolean }) => {
      el.textContent = `[rendered:${tex}:${opts.displayMode ? "block" : "inline"}]`;
    }),
  },
}));
// The CSS import is a side-effect-only module — stub it away.
vi.mock("katex/dist/katex.min.css", () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderMathIn()", () => {
  it("is a no-op (no katex import) when there are no [data-math] nodes", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>plain text</p>";
    await renderMathIn(root);
    // katex mock would have been called if nodes were found.
    const { default: katex } = await import("katex");
    expect(katex.render).not.toHaveBeenCalled();
    expect(root.querySelector("p")!.textContent).toBe("plain text");
  });

  it("renders an inline math node and removes data-math", async () => {
    const root = document.createElement("div");
    const span = document.createElement("span");
    span.className = "math-inline";
    span.dataset.math = "";
    span.textContent = "e^{i\\pi}+1=0";
    root.appendChild(span);

    await renderMathIn(root);

    expect(span.textContent).toContain("[rendered:e^{i\\pi}+1=0:inline]");
    // The attribute must be removed so a second pass is a no-op.
    expect(span.hasAttribute("data-math")).toBe(false);
  });

  it("renders a block math node in displayMode", async () => {
    const root = document.createElement("div");
    const div = document.createElement("div");
    div.className = "math-block";
    div.dataset.math = "";
    div.textContent = "\\int_0^1 x\\,dx";
    root.appendChild(div);

    await renderMathIn(root);

    expect(div.textContent).toContain("[rendered:\\int_0^1 x\\,dx:block]");
    expect(div.hasAttribute("data-math")).toBe(false);
  });

  it("renders multiple nodes in a single pass", async () => {
    const root = document.createElement("div");
    for (let i = 0; i < 3; i++) {
      const span = document.createElement("span");
      span.className = "math-inline";
      span.dataset.math = "";
      span.textContent = `x_${i}`;
      root.appendChild(span);
    }

    await renderMathIn(root);

    const { default: katex } = await import("katex");
    expect(katex.render).toHaveBeenCalledTimes(3);
    // All nodes must have their data-math attribute removed.
    expect(root.querySelectorAll("[data-math]")).toHaveLength(0);
  });

  it("already-rendered nodes (no data-math) are not re-processed", async () => {
    const root = document.createElement("div");
    // A node that was already rendered: data-math was removed.
    const span = document.createElement("span");
    span.className = "math-inline";
    // No dataset.math — simulates a previously processed node.
    span.textContent = "[already rendered]";
    root.appendChild(span);

    await renderMathIn(root);

    const { default: katex } = await import("katex");
    // No [data-math] nodes found — katex.render should not be called.
    expect(katex.render).not.toHaveBeenCalled();
  });

  it("handles an empty textContent gracefully (renders empty string)", async () => {
    const root = document.createElement("div");
    const span = document.createElement("span");
    span.className = "math-inline";
    span.dataset.math = "";
    // textContent is null/empty — should not throw.
    root.appendChild(span);

    await expect(renderMathIn(root)).resolves.toBeUndefined();
  });
});
