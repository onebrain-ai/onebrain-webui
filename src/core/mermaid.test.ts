import { describe, it, expect } from "vitest";
import { mermaidType, beautifulSupports } from "./mermaid";

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
