// Separate test file for the "beautiful-mermaid import fails" path (line 135 in
// mermaid.ts). Kept isolated from mermaid.test.ts because vi.mock is file-scoped:
// making the BM mock throw on import would break the normal-path tests.

import { describe, it, expect, vi } from "vitest";

// Make beautiful-mermaid's factory throw — simulates a chunk load failure so the
// outer catch in renderMermaidIn (line 133-136) fires and pushes all candidates
// to the official engine.
vi.mock("beautiful-mermaid", () => {
  throw new Error("chunk load failed");
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
      for (const n of nodes) { n.innerHTML = "<svg><text>official</text></svg>"; }
    }),
  },
}));

vi.mock("./richviewport", () => ({
  mountViewport: vi.fn(() => ({ destroy: vi.fn(), refreshLabel: vi.fn() })),
}));

describe("renderMermaidIn — BM module load failure (line 135)", () => {
  it("falls back ALL supported-type candidates to the official engine when BM import throws", async () => {
    const { renderMermaidIn } = await import("./mermaid");
    const { default: mermaid } = await import("mermaid");

    const root = document.createElement("div");
    // Two flowchart nodes — both would normally go to BM, but the module fails.
    for (const src of ["flowchart TD\n  A-->B", "graph LR\n  X-->Y"]) {
      const pre = document.createElement("pre");
      pre.className = "mermaid";
      pre.setAttribute("data-mermaid", "");
      pre.textContent = src;
      root.appendChild(pre);
    }

    await renderMermaidIn(root);

    // Official engine must have been called with both nodes.
    expect(mermaid.run).toHaveBeenCalled();
    const call = vi.mocked(mermaid.run).mock.calls[0][0] as { nodes: HTMLElement[] };
    expect(call.nodes).toHaveLength(2);
  });
});
