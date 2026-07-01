import { describe, it, expect, vi, beforeEach } from "vitest";
import { enhanceCodeBlocksIn } from "./codeblock";

// Mock heavy dependencies so tests are fast and offline.
vi.mock("dompurify", () => ({
  default: { sanitize: (s: string) => s },
}));

// formatCode is used only for json/jsonc langs — mock it with a simple pass-through.
vi.mock("./codeformat", () => ({
  formatCode: vi.fn(async (_lang: string, text: string) => text),
}));

// @lezer/highlight — emit TWO spans so both branches of `if (from > pos)` are hit:
// 1. cb(2,5,...) → from=2 > pos=0 → gap-fill branch (true)
// 2. cb(5,8,...) → from=5 === pos=5 → no-gap branch (false)
vi.mock("@lezer/highlight", () => ({
  highlightTree: vi.fn(
    (_tree: unknown, _hl: unknown, cb: (from: number, to: number, cls: string) => void) => {
      cb(2, 5, "tok-keyword"); // gap from 0 to 2 (from > pos = true)
      cb(5, 8, "tok-string");  // no gap (from === pos = false)
    },
  ),
  classHighlighter: {},
}));

// Stub parser used by both HCL and non-HCL paths.
const stubParser = { parse: () => ({}) };

// @codemirror/language — use a vi.fn() defined INSIDE the factory to avoid
// hoisting issues. Expose it on the module mock so tests can override it.
vi.mock("@codemirror/language", () => ({
  LanguageDescription: {
    matchLanguageName: vi.fn(() => ({
      load: async () => ({ language: { parser: stubParser } }),
    })),
  },
}));

vi.mock("@codemirror/language-data", () => ({ languages: [] }));

// codemirror-lang-hcl — default success.
vi.mock("codemirror-lang-hcl", () => ({
  hclLanguage: { parser: { parse: () => ({}) } },
}));

// Stub navigator.clipboard so the copy button handler can be exercised.
const writeTextMock = vi.fn(() => Promise.resolve());
vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });

beforeEach(() => {
  vi.clearAllMocks();
  writeTextMock.mockResolvedValue(undefined);
});

/** Build a minimal DOM with a <pre><code class="language-{lang}">{text}</code></pre>. */
function makeRoot(lang: string, text: string): HTMLElement {
  const root = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (lang) code.className = `language-${lang}`;
  code.textContent = text;
  pre.appendChild(code);
  root.appendChild(pre);
  return root;
}

describe("enhanceCodeBlocksIn() — basic enhancement", () => {
  it("wraps the code block in a .cm-codeblock div and marks pre as enhanced", async () => {
    // Use code with &, < and > to cover all three branches of the esc() helper (line 14).
    const root = makeRoot("ts", "a & b < c > d");
    await enhanceCodeBlocksIn(root);
    const block = root.querySelector(".cm-codeblock") as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.dataset.enhanced).toBe("1");
    expect(block.dataset.lang).toBe("ts");
  });

  it("generates a line-number gutter", async () => {
    const root = makeRoot("ts", "line1\nline2\nline3");
    await enhanceCodeBlocksIn(root);
    const gutter = root.querySelector(".cm-code-gutter") as HTMLElement;
    expect(gutter).not.toBeNull();
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    expect(gutter.textContent).toBe("1\n2\n3");
  });

  it("adds a copy button with the correct attributes", async () => {
    const root = makeRoot("ts", "hello");
    await enhanceCodeBlocksIn(root);
    const btn = root.querySelector("button.cm-code-copy") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.type).toBe("button");
    expect(btn.title).toBe("Copy code");
    expect(btn.getAttribute("aria-label")).toBe("Copy code");
  });

  it("strips the trailing newline from textContent before processing", async () => {
    const root = makeRoot("ts", "only one line\n");
    await enhanceCodeBlocksIn(root);
    const gutter = root.querySelector(".cm-code-gutter") as HTMLElement;
    expect(gutter.textContent).toBe("1");
  });
});

describe("enhanceCodeBlocksIn() — idempotency", () => {
  it("skips blocks that are already inside a .cm-codeblock", async () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.className = "cm-codeblock";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = "language-ts";
    code.textContent = "x";
    pre.appendChild(code);
    block.appendChild(pre);
    root.appendChild(block);
    await enhanceCodeBlocksIn(root);
    expect(root.querySelectorAll(".cm-codeblock")).toHaveLength(1);
  });

  it("skips blocks with data-enhanced already set", async () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.dataset.enhanced = "1";
    const code = document.createElement("code");
    code.className = "language-ts";
    code.textContent = "x";
    pre.appendChild(code);
    root.appendChild(pre);
    await enhanceCodeBlocksIn(root);
    expect(root.querySelector(".cm-codeblock")).toBeNull();
  });
});

describe("enhanceCodeBlocksIn() — mermaid fences are skipped", () => {
  it("does not enhance a <pre class='mermaid'> block", async () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    const code = document.createElement("code");
    code.className = "language-mermaid";
    code.textContent = "graph TD\n  A-->B";
    pre.appendChild(code);
    root.appendChild(pre);
    await enhanceCodeBlocksIn(root);
    expect(root.querySelector(".cm-codeblock")).toBeNull();
  });
});

describe("enhanceCodeBlocksIn() — no code blocks", () => {
  it("is a no-op on an empty root", async () => {
    const root = document.createElement("div");
    root.textContent = "plain text";
    await expect(enhanceCodeBlocksIn(root)).resolves.toBeUndefined();
  });
});

describe("enhanceCodeBlocksIn() — JSON pretty-printing", () => {
  it("calls formatCode for json lang", async () => {
    const { formatCode } = await import("./codeformat");
    const root = makeRoot("json", '{"a":1}');
    await enhanceCodeBlocksIn(root);
    expect(formatCode).toHaveBeenCalledWith("json", '{"a":1}');
  });

  it("calls formatCode for jsonc lang", async () => {
    const { formatCode } = await import("./codeformat");
    const root = makeRoot("jsonc", '{"a":1}');
    await enhanceCodeBlocksIn(root);
    expect(formatCode).toHaveBeenCalledWith("jsonc", '{"a":1}');
  });

  it("does NOT call formatCode for yaml (yaml is excluded from reflow)", async () => {
    const { formatCode } = await import("./codeformat");
    const root = makeRoot("yaml", "key: val");
    await enhanceCodeBlocksIn(root);
    expect(formatCode).not.toHaveBeenCalled();
  });
});

describe("enhanceCodeBlocksIn() — HCL / Terraform language (covers lines 25-28)", () => {
  it("enhances an hcl block using the codemirror-lang-hcl grammar", async () => {
    const root = makeRoot("hcl", 'resource "aws_s3_bucket" "b" {}');
    await enhanceCodeBlocksIn(root);
    expect(root.querySelector(".cm-codeblock")).not.toBeNull();
  });

  it("enhances a terraform block using the hcl grammar", async () => {
    const root = makeRoot("terraform", "variable \"x\" {}");
    await enhanceCodeBlocksIn(root);
    expect(root.querySelector(".cm-codeblock")).not.toBeNull();
  });

  it("falls back gracefully when codemirror-lang-hcl throws (covers line 27-28)", async () => {
    // Override the mock to throw on import — use vi.doMock after resetting modules.
    vi.doMock("codemirror-lang-hcl", () => {
      throw new Error("module not found");
    });
    vi.resetModules();
    const { enhanceCodeBlocksIn: fresh } = await import("./codeblock");
    const root = makeRoot("tf", "output {}");
    // highlightToHtml returns null on catch → block is still enhanced with plain text.
    await expect(fresh(root)).resolves.toBeUndefined();
    expect(root.querySelector(".cm-codeblock")).not.toBeNull();
    // Restore for subsequent tests.
    vi.doMock("codemirror-lang-hcl", () => ({
      hclLanguage: { parser: { parse: () => ({}) } },
    }));
    vi.resetModules();
  });
});

describe("enhanceCodeBlocksIn() — unknown language (covers line 32)", () => {
  it("enhances the block with plain text when matchLanguageName returns null", async () => {
    // Override the mock's matchLanguageName to return null for this test.
    const { LanguageDescription } = await import("@codemirror/language");
    vi.mocked(LanguageDescription.matchLanguageName).mockReturnValueOnce(null as unknown as ReturnType<typeof LanguageDescription.matchLanguageName>);
    const root = makeRoot("brainfuck", "++++[>++<-]");
    await enhanceCodeBlocksIn(root);
    // The block is still created, just without highlighted HTML.
    expect(root.querySelector(".cm-codeblock")).not.toBeNull();
  });

  it("falls back to plain text when desc.load() throws (covers line 36)", async () => {
    const { LanguageDescription } = await import("@codemirror/language");
    vi.mocked(LanguageDescription.matchLanguageName).mockReturnValueOnce({
      load: async () => {
        throw new Error("grammar load failed");
      },
    } as unknown as ReturnType<typeof LanguageDescription.matchLanguageName>);
    const root = makeRoot("rust", "fn main() {}");
    await enhanceCodeBlocksIn(root);
    expect(root.querySelector(".cm-codeblock")).not.toBeNull();
  });
});

describe("enhanceCodeBlocksIn() — copy button click", () => {
  it("writes code text to clipboard on click and shows a copied state", async () => {
    vi.useFakeTimers();
    const root = makeRoot("ts", "copy me");
    await enhanceCodeBlocksIn(root);
    const btn = root.querySelector("button.cm-code-copy") as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    expect(writeTextMock).toHaveBeenCalledWith("copy me");
    expect(btn.classList.contains("is-copied")).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(btn.classList.contains("is-copied")).toBe(false);
    vi.useRealTimers();
  });

  it("is non-fatal when clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    const root = makeRoot("ts", "no clipboard");
    await enhanceCodeBlocksIn(root);
    const btn = root.querySelector("button.cm-code-copy") as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
    vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });
  });
});

describe("enhanceCodeBlocksIn() — no-lang code block", () => {
  it("enhances a code block without a language class (textContent fallback)", async () => {
    const root = document.createElement("div");
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = "no lang here";
    pre.appendChild(code);
    root.appendChild(pre);
    await enhanceCodeBlocksIn(root);
    const block = root.querySelector(".cm-codeblock") as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.dataset.lang).toBeUndefined();
  });
});
