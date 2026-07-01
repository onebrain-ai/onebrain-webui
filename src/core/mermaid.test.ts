import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mermaidType, beautifulSupports, renderMermaidIn, addMermaidZoomControls } from "./mermaid";

// Mock dynamic imports so tests run without a real bundler resolution.
vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVG: vi.fn((_src: string) => '<svg><text>bm</text></svg>'),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
      // Simulate the official engine writing SVG into the node.
      for (const n of nodes) { n.innerHTML = "<svg><text>mermaid</text></svg>"; }
    }),
  },
}));

vi.mock("./richviewport", () => ({
  mountViewport: vi.fn(() => ({ destroy: vi.fn(), refreshLabel: vi.fn() })),
}));

describe("mermaidType", () => {
  it("reads the header keyword, lowercased", () => {
    expect(mermaidType("flowchart TD\n A --> B")).toBe("flowchart");
    expect(mermaidType("graph LR; A-->B")).toBe("graph");
    expect(mermaidType("sequenceDiagram\n A->>B: hi")).toBe("sequencediagram");
    expect(mermaidType("stateDiagram-v2\n [*] --> S")).toBe("statediagram-v2");
    expect(mermaidType("xychart-beta\n bar [1,2,3]")).toBe("xychart-beta");
    expect(mermaidType("gitGraph\n commit")).toBe("gitgraph");
  });

  it("skips a leading frontmatter block and %% directives/comments", () => {
    expect(mermaidType("---\nconfig:\n  theme: dark\n---\nflowchart TD\n A-->B")).toBe("flowchart");
    expect(mermaidType("%%{init: {'theme':'dark'}}%%\nflowchart LR\n A-->B")).toBe("flowchart");
    expect(mermaidType("\n\n  %% a comment\n  erDiagram\n  A ||--o{ B : x")).toBe("erdiagram");
  });

  it("skips a MULTI-LINE %%{init}%% block to reach the real header", () => {
    expect(mermaidType('%%{init: {\n  "theme": "dark"\n}}%%\nflowchart TD\n A-->B')).toBe("flowchart");
    expect(mermaidType("%%{\n  init: { theme: base }\n}%%\nsequenceDiagram\n A->>B: hi")).toBe("sequencediagram");
  });

  it("returns empty for an UNCLOSED frontmatter block (→ official engine)", () => {
    expect(mermaidType("---\nconfig: broken\nflowchart TD\n A-->B")).toBe("");
  });

  it("returns empty when frontmatter block closes with nothing after it (nl==-1 branch)", () => {
    // `---\nconfig\n---` — the closing `---` is the last line with no trailing newline.
    // text.indexOf("\n", close + 1) returns -1 → text is set to "".
    expect(mermaidType("---\nconfig: dark\n---")).toBe("");
  });

  it("is empty for blank input", () => {
    expect(mermaidType("   \n\n")).toBe("");
  });
});

describe("beautifulSupports", () => {
  it("routes the six supported types to beautiful-mermaid", () => {
    for (const src of [
      "flowchart TD\n A-->B",
      "graph LR\n A-->B",
      "sequenceDiagram\n A->>B: hi",
      "classDiagram\n class A",
      "erDiagram\n A ||--o{ B : x",
      "stateDiagram-v2\n [*] --> S",
      "xychart-beta\n bar [1,2]",
    ]) {
      expect(beautifulSupports(src)).toBe(true);
    }
  });

  it("falls back to the official engine for unsupported types", () => {
    for (const src of ["gitGraph\n commit", "gantt\n title X", "pie title P", "mindmap\n root", "journey\n title J"]) {
      expect(beautifulSupports(src)).toBe(false);
    }
  });
});

// ── helpers for DOM-based tests ───────────────────────────────────────────────

/** Create a root div and append mermaid pre nodes with the given sources. */
function makeRoot(...sources: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const src of sources) {
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.setAttribute("data-mermaid", "");
    pre.textContent = src;
    root.appendChild(pre);
  }
  return root;
}


describe("renderMermaidIn", () => {
  // Reset module-level cache between tests so each test gets a fresh init path.
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when there are no mermaid nodes", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>no diagrams here</p>";
    // Neither engine should be imported — just verify it resolves cleanly.
    await expect(renderMermaidIn(root)).resolves.toBeUndefined();
  });

  it("renders a beautiful-mermaid-supported diagram via the BM engine", async () => {
    const root = makeRoot("flowchart TD\n  A-->B");
    await renderMermaidIn(root);
    const pre = root.querySelector("pre.mermaid") as HTMLElement;
    // BM engine writes SVG into innerHTML and sets data-processed=bm.
    expect(pre.getAttribute("data-processed")).toBe("bm");
    expect(pre.innerHTML).toContain("<svg");
  });

  it("routes an unsupported type straight to the official mermaid engine", async () => {
    const { default: mermaid } = await import("mermaid");
    const root = makeRoot("gitGraph\n  commit");
    await renderMermaidIn(root);
    expect(mermaid.run).toHaveBeenCalled();
  });

  it("strips @import and external url() from BM SVG output (security scrub)", async () => {
    const bm = await import("beautiful-mermaid");
    // BM engine returns SVG that contains an @import and an external url().
    vi.mocked(bm.renderMermaidSVG).mockReturnValueOnce(
      '<svg><style>@import url("https://evil.com/x.css");</style><text>ok</text></svg>',
    );
    const root = makeRoot("flowchart TD\n  A-->B");
    await renderMermaidIn(root);
    const html = (root.querySelector("pre.mermaid") as HTMLElement).innerHTML;
    expect(html).not.toContain("@import");
    expect(html).not.toContain("https://evil.com");
  });

  it("falls back to the official engine when BM throws on a supported type", async () => {
    const bm = await import("beautiful-mermaid");
    vi.mocked(bm.renderMermaidSVG).mockImplementationOnce(() => { throw new Error("parse error"); });
    const { default: mermaid } = await import("mermaid");
    const root = makeRoot("flowchart TD\n  A-->B");
    await renderMermaidIn(root);
    // Official engine must have been called because BM threw.
    expect(mermaid.run).toHaveBeenCalled();
  });

  it("clears data-processed before re-rendering (idempotent re-run)", async () => {
    const root = makeRoot("flowchart TD\n  A-->B");
    const pre = root.querySelector("pre.mermaid") as HTMLElement;
    pre.setAttribute("data-processed", "old");
    await renderMermaidIn(root);
    // After the pass data-processed should be "bm", not the stale "old".
    expect(pre.getAttribute("data-processed")).toBe("bm");
  });
});

describe("addMermaidZoomControls", () => {
  it("adds an expand button to each rendered mermaid node that has an SVG", () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pre.appendChild(svg);
    root.appendChild(pre);

    addMermaidZoomControls(root);

    const btn = pre.querySelector(".mermaid-expand");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("Open full screen");
    expect(pre.classList.contains("mermaid-zoomable")).toBe(true);
  });

  it("is idempotent — does not double-add the button", () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    root.appendChild(pre);

    addMermaidZoomControls(root);
    addMermaidZoomControls(root); // second call — should not add a second button

    expect(root.querySelectorAll(".mermaid-expand")).toHaveLength(1);
  });

  it("skips nodes that have no SVG child (not yet rendered)", () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    // No <svg> child — BM/official hasn't run yet.
    root.appendChild(pre);

    addMermaidZoomControls(root);

    expect(pre.querySelector(".mermaid-expand")).toBeNull();
  });

  it("clicking the expand button calls mountViewport (overlay opens)", async () => {
    const { mountViewport } = await import("./richviewport");
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pre.appendChild(svg);
    root.appendChild(pre);
    document.body.appendChild(root);

    addMermaidZoomControls(root);

    const btn = pre.querySelector<HTMLElement>(".mermaid-expand")!;
    btn.click();

    expect(mountViewport).toHaveBeenCalled();

    // Clean up the overlay the click() added to document.body.
    document.body.querySelector(".mermaid-overlay")?.remove();
    document.body.removeChild(root);
  });

  it("clicking the overlay close button dismisses the overlay (calls handle.destroy)", async () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pre.appendChild(svg);
    root.appendChild(pre);
    document.body.appendChild(root);

    addMermaidZoomControls(root);
    pre.querySelector<HTMLElement>(".mermaid-expand")!.click();

    const overlay = document.body.querySelector<HTMLElement>(".mermaid-overlay")!;
    expect(overlay).not.toBeNull();

    // Click the close button — should call handle.destroy() and remove the overlay.
    const closeBtn = overlay.querySelector<HTMLElement>(".mermaid-overlay-close")!;
    closeBtn.click();

    expect(document.body.querySelector(".mermaid-overlay")).toBeNull();
    document.body.removeChild(root);
  });

  it("pressing Escape dismisses the overlay", async () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pre.appendChild(svg);
    root.appendChild(pre);
    document.body.appendChild(root);

    addMermaidZoomControls(root);
    pre.querySelector<HTMLElement>(".mermaid-expand")!.click();

    expect(document.body.querySelector(".mermaid-overlay")).not.toBeNull();

    // Dispatch Escape — the onKey handler calls dismiss().
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.querySelector(".mermaid-overlay")).toBeNull();

    document.body.removeChild(root);
  });

  it("pressing a non-Escape key does NOT dismiss the overlay", async () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    root.appendChild(pre);
    document.body.appendChild(root);

    addMermaidZoomControls(root);
    pre.querySelector<HTMLElement>(".mermaid-expand")!.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(document.body.querySelector(".mermaid-overlay")).not.toBeNull();

    // Clean up.
    document.body.querySelector(".mermaid-overlay")?.remove();
    document.body.removeChild(root);
  });
});
