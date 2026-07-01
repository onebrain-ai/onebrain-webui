// Tests for richfile.ts: rich (non-text) file preview rendering.
// All binary-parsing libraries (xlsx, mammoth, pptx-renderer, maxgraph, pako,
// jszip) are mocked so no real file parsing happens — tests stay deterministic
// and fast regardless of the binary content passed in.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRichFile, richLabel, renderRichFile } from "./richfile";
import type { DaemonClient } from "./daemon";
import type { PptxViewer } from "@aiden0z/pptx-renderer";

// ── module-level mocks ────────────────────────────────────────────────────────

// DOMPurify: pass-through (security tested elsewhere in markdown.test.ts)
vi.mock("dompurify", () => ({
  default: { sanitize: (s: string) => s },
}));

// CSS side-effect imports — no content needed
vi.mock("./richfile.css", () => ({}));

// richviewport — returns a stub handle so renderPptx / renderDrawio don't crash
vi.mock("./richviewport", () => ({
  mountViewport: vi.fn(() => ({ destroy: vi.fn(), refreshLabel: vi.fn() })),
}));

// markdown module used by renderIpynb
vi.mock("./markdown", () => ({
  renderMarkdown: vi.fn((s: string) => ({ html: `<p>${s}</p>` })),
}));

// codeblock module used by renderIpynb
vi.mock("./codeblock", () => ({
  enhanceCodeBlocksIn: vi.fn(async () => {}),
}));

// SheetJS (xlsx)
vi.mock("xlsx", async () => {
  const sheet: Record<string, unknown> = { "!ref": "A1:B2" };
  return {
    read: vi.fn(() => ({
      SheetNames: ["Sheet1", "Sheet2"],
      Sheets: { Sheet1: sheet, Sheet2: sheet },
    })),
    utils: {
      sheet_to_html: vi.fn(() => "<table><tr><td>A1</td></tr></table>"),
    },
  };
});

// mammoth (docx → HTML)
vi.mock("mammoth", () => ({
  convertToHtml: vi.fn(async () => ({ value: "<p>Doc content</p>" })),
}));

// pptx-renderer
vi.mock("@aiden0z/pptx-renderer", () => ({
  PptxViewer: {
    open: vi.fn(async () => ({
      slideCount: 3,
      renderSlide: vi.fn(async () => {}),
      destroy: vi.fn(),
    })),
  },
}));

// maxgraph — Graph must be a real constructor (called with `new`)
const mockGraphInstance = {
  setEnabled: vi.fn(),
  setHtmlLabels: vi.fn(),
  getDataModel: vi.fn(() => ({})),
  getPlugin: vi.fn(() => ({ fitCenter: vi.fn() })),
};
class MockGraph {
  constructor(_stage: unknown, _model: unknown, _plugins: unknown) {
    Object.assign(this, mockGraphInstance);
  }
}
const mockModelXmlSerializerInstance = { import: vi.fn() };
class MockModelXmlSerializer {
  constructor(_model: unknown) {
    Object.assign(this, mockModelXmlSerializerInstance);
  }
}
vi.mock("@maxgraph/core", () => ({
  Graph: MockGraph,
  ModelXmlSerializer: MockModelXmlSerializer,
  FitPlugin: "FitPlugin",
}));

// pako (drawio compressed format)
vi.mock("pako", () => ({
  inflateRaw: vi.fn(() => new Uint8Array(Array.from("encoded model", (c) => c.charCodeAt(0)))),
}));

// jszip — default returns null for all files so font logic short-circuits.
// Individual tests override jszipFileMap to simulate embedded fonts.
let jszipFileMap: Record<string, { async: (fmt: string) => Promise<unknown> } | null> = {};
vi.mock("jszip", () => ({
  default: {
    loadAsync: vi.fn(async () => ({
      file: vi.fn((name: string) => jszipFileMap[name] ?? null),
    })),
  },
}));

// Reset the jszip file map before each test so tests don't bleed into each other
beforeEach(() => { jszipFileMap = {}; });

// ── helpers ────────────────────────────────────────────────────────────────────

/** Build a jszip-style file entry for a given format output. */
function jszipEntry(value: unknown): { async: (fmt: string) => Promise<unknown> } {
  return { async: vi.fn(async () => value) };
}

/** Minimal DaemonClient stub: fileBlob returns an ArrayBuffer, file returns text. */
function makeDaemon(opts: { content?: string } = {}): DaemonClient {
  const content = opts.content ?? "";
  return {
    fileBlob: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as DaemonClient["fileBlob"],
    file: vi.fn(async () => ({ content, rev: "1", path: "" })) as unknown as DaemonClient["file"],
  } as unknown as DaemonClient;
}

/** Minimal drawio XML with an uncompressed mxGraphModel. */
const DRAWIO_UNCOMPRESSED = `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>`;

/** Drawio file containing a label with HTML markup (sanitization path). */
const DRAWIO_HTML_LABEL = `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel>
  <root><mxCell id="0" value="&lt;b&gt;hello&lt;/b&gt;"/></root>
</mxGraphModel></diagram></mxfile>`;

/** Bare mxGraphModel (no wrapping mxfile/diagram). */
const DRAWIO_BARE_MODEL = `<?xml version="1.0"?>
<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>`;

/** Minimal valid ipynb JSON. */
const IPYNB_BASIC = JSON.stringify({
  cells: [
    { cell_type: "markdown", source: "# Hello" },
    { cell_type: "code", source: "print('hi')", outputs: [] },
  ],
  metadata: { language_info: { name: "python" } },
});

// ── isRichFile ─────────────────────────────────────────────────────────────────

describe("isRichFile", () => {
  it.each(["file.xlsx", "data.csv", "tab.tsv", "report.docx", "deck.pptx", "flow.drawio", "nb.ipynb"])(
    "returns true for %s",
    (p) => expect(isRichFile(p)).toBe(true),
  );

  it.each(["note.md", "script.ts", "image.png", "style.css", "README", "no-ext"])(
    "returns false for %s",
    (p) => expect(isRichFile(p)).toBe(false),
  );

  it("is case-insensitive on extension", () => {
    expect(isRichFile("REPORT.XLSX")).toBe(true);
    expect(isRichFile("Doc.DOCX")).toBe(true);
  });
});

// ── richLabel ──────────────────────────────────────────────────────────────────

describe("richLabel", () => {
  it.each([
    ["sheet.xlsx", "Spreadsheet"],
    ["data.csv", "Table"],
    ["tab.tsv", "Table"],
    ["report.docx", "Document"],
    ["deck.pptx", "Slides"],
    ["flow.drawio", "Diagram"],
    ["nb.ipynb", "Notebook"],
  ])("returns correct label for %s", (p, label) => {
    expect(richLabel(p)).toBe(label);
  });

  it("returns 'File' for unknown extensions", () => {
    expect(richLabel("archive.zip")).toBe("File");
    expect(richLabel("noext")).toBe("File");
  });
});

// ── renderRichFile — dispatch and default ────────────────────────────────────

describe("renderRichFile — unknown extension (default branch)", () => {
  it("sets the 'not available' message for an unrecognized extension", async () => {
    const host = document.createElement("div");
    await renderRichFile("archive.zip", host, makeDaemon());
    // Source uses the right-curly apostrophe (U+2019) in "isn't"
    expect(host.innerHTML).toContain("Preview isn’t available");
  });
});

// ── renderRichFile — xlsx / csv / tsv ─────────────────────────────────────────

describe("renderRichFile — xlsx (SheetJS)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders tab buttons for a multi-sheet workbook", async () => {
    const host = document.createElement("div");
    await renderRichFile("report.xlsx", host, makeDaemon());
    // Two sheets → tab bar rendered
    expect(host.querySelectorAll(".rich-tab").length).toBe(2);
    expect(host.querySelector(".rich-tab.is-active")).not.toBeNull();
  });

  it("first tab is active and first panel is visible", async () => {
    const host = document.createElement("div");
    await renderRichFile("data.xlsx", host, makeDaemon());
    const panels = host.querySelectorAll(".rich-tab-panel");
    expect(panels[0].classList.contains("rich-hidden")).toBe(false);
    expect(panels[1].classList.contains("rich-hidden")).toBe(true);
  });

  it("clicking the second tab activates it and hides the first", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("data.xlsx", host, makeDaemon());
    const tabs = host.querySelectorAll<HTMLButtonElement>(".rich-tab");
    tabs[1].click();
    expect(tabs[1].classList.contains("is-active")).toBe(true);
    expect(tabs[0].classList.contains("is-active")).toBe(false);
    const panels = host.querySelectorAll(".rich-tab-panel");
    expect(panels[1].classList.contains("rich-hidden")).toBe(false);
    expect(panels[0].classList.contains("rich-hidden")).toBe(true);
    host.remove();
  });

  it("renders csv via the xlsx renderer (same code path)", async () => {
    const host = document.createElement("div");
    await renderRichFile("data.csv", host, makeDaemon());
    expect(host.querySelectorAll(".rich-tab").length).toBe(2);
  });

  it("renders tsv via the xlsx renderer", async () => {
    const host = document.createElement("div");
    await renderRichFile("data.tsv", host, makeDaemon());
    expect(host.querySelectorAll(".rich-tab").length).toBe(2);
  });

  it("shows 'no sheets' message when workbook has no sheets", async () => {
    const { read } = await import("xlsx");
    vi.mocked(read).mockReturnValueOnce({ SheetNames: [], Sheets: {} });
    const host = document.createElement("div");
    await renderRichFile("empty.xlsx", host, makeDaemon());
    expect(host.innerHTML).toContain("no sheets");
  });

  it("skips the tab bar for a single-sheet workbook", async () => {
    const { read } = await import("xlsx");
    const sheet = { "!ref": "A1" };
    vi.mocked(read).mockReturnValueOnce({ SheetNames: ["Only"], Sheets: { Only: sheet } });
    const host = document.createElement("div");
    await renderRichFile("single.xlsx", host, makeDaemon());
    // No tab buttons for a single sheet
    expect(host.querySelectorAll(".rich-tab").length).toBe(0);
    // But the panel is present
    expect(host.querySelector(".rich-tab-panel")).not.toBeNull();
  });
});

// ── renderRichFile — docx (mammoth) ───────────────────────────────────────────

describe("renderRichFile — docx (mammoth)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders document HTML inside .rich-doc article", async () => {
    const host = document.createElement("div");
    await renderRichFile("report.docx", host, makeDaemon());
    const article = host.querySelector(".rich-doc");
    expect(article).not.toBeNull();
    expect(article!.innerHTML).toContain("Doc content");
  });

  it("shows 'empty document' message when mammoth returns empty string", async () => {
    const mammoth = await import("mammoth");
    vi.mocked(mammoth.convertToHtml).mockResolvedValueOnce({ value: "", messages: [] });
    const host = document.createElement("div");
    await renderRichFile("empty.docx", host, makeDaemon());
    expect(host.innerHTML).toContain("empty");
  });

  it("does not prepend a <style> when no embedded fonts are found (jszip returns null)", async () => {
    const host = document.createElement("div");
    await renderRichFile("report.docx", host, makeDaemon());
    // jszip mock returns null for all files → no @font-face injected
    expect(host.querySelector("style")).toBeNull();
  });
});

// ── renderRichFile — ipynb ─────────────────────────────────────────────────────

describe("renderRichFile — ipynb", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders markdown and code cells inside .nb-doc", async () => {
    const host = document.createElement("div");
    await renderRichFile("nb.ipynb", host, makeDaemon({ content: IPYNB_BASIC }));
    expect(host.querySelector(".nb-doc")).not.toBeNull();
    expect(host.querySelector(".nb-md")).not.toBeNull();
    expect(host.querySelector(".nb-cell")).not.toBeNull();
  });

  it("shows invalid JSON message on unparsable content", async () => {
    const host = document.createElement("div");
    await renderRichFile("bad.ipynb", host, makeDaemon({ content: "{not json" }));
    expect(host.innerHTML).toContain("invalid JSON");
  });

  it("shows empty message when notebook has no cells", async () => {
    const host = document.createElement("div");
    await renderRichFile("empty.ipynb", host, makeDaemon({ content: JSON.stringify({ cells: [] }) }));
    expect(host.innerHTML).toContain("empty");
  });

  it("renders stream output as <pre class='nb-out'>", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "print('hi')",
          outputs: [{ output_type: "stream", text: "hi\n" }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("stream.ipynb", host, makeDaemon({ content: nb }));
    expect(host.querySelector(".nb-out")).not.toBeNull();
  });

  it("renders error output as <pre class='nb-err'> with ANSI stripped", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "1/0",
          outputs: [{ output_type: "error", traceback: ["[31mTraceback[0m", "ZeroDivisionError"] }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("err.ipynb", host, makeDaemon({ content: nb }));
    const el = host.querySelector(".nb-err");
    expect(el).not.toBeNull();
    // ANSI escape codes stripped
    expect(el!.textContent).not.toContain("[");
    expect(el!.textContent).toContain("Traceback");
  });

  it("renders execute_result with text/html output", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "df",
          outputs: [{ output_type: "execute_result", data: { "text/html": "<table/>" } }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("html_out.ipynb", host, makeDaemon({ content: nb }));
    expect(host.querySelector(".nb-html")).not.toBeNull();
  });

  it("renders execute_result with text/plain fallback", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "42",
          outputs: [{ output_type: "execute_result", data: { "text/plain": "42" } }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("plain_out.ipynb", host, makeDaemon({ content: nb }));
    expect(host.querySelector(".nb-out")).not.toBeNull();
  });

  it("renders display_data with image/png output", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "plot()",
          outputs: [{ output_type: "display_data", data: { "image/png": "aGVsbG8=" } }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("img_out.ipynb", host, makeDaemon({ content: nb }));
    const img = host.querySelector(".nb-img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("data:image/png;base64,");
  });

  it("renders display_data with image/jpeg output", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "show()",
          outputs: [{ output_type: "display_data", data: { "image/jpeg": "aGVsbG8=" } }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("jpg_out.ipynb", host, makeDaemon({ content: nb }));
    const img = host.querySelector(".nb-img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toContain("data:image/jpeg;base64,");
  });

  it("skips empty code cells (no source, no outputs)", async () => {
    const nb = JSON.stringify({
      cells: [{ cell_type: "code", source: "   ", outputs: [] }],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("empty_cell.ipynb", host, makeDaemon({ content: nb }));
    // The empty cell produces no nb-cell div but the nb-doc container is present
    expect(host.querySelector(".nb-doc")).not.toBeNull();
    expect(host.querySelector(".nb-cell")).toBeNull();
  });

  it("uses kernelspec language as fallback when language_info is absent", async () => {
    const nb = JSON.stringify({
      cells: [{ cell_type: "code", source: "x = 1", outputs: [] }],
      metadata: { kernelspec: { language: "julia" } },
    });
    const host = document.createElement("div");
    await renderRichFile("julia.ipynb", host, makeDaemon({ content: nb }));
    expect(host.innerHTML).toContain("language-julia");
  });

  it("source as array of strings is joined", async () => {
    const nb = JSON.stringify({
      cells: [{ cell_type: "code", source: ["a = 1\n", "b = 2"], outputs: [] }],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("arr_source.ipynb", host, makeDaemon({ content: nb }));
    expect(host.querySelector(".nb-cell")).not.toBeNull();
  });

  it("ignores cells with unknown cell_type", async () => {
    const nb = JSON.stringify({
      cells: [{ cell_type: "raw", source: "raw data" }],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("raw.ipynb", host, makeDaemon({ content: nb }));
    // raw cells produce no output but the nb-doc wrapper is present
    expect(host.querySelector(".nb-doc")).not.toBeNull();
    // raw text does NOT appear in rendered output
    expect(host.textContent).not.toContain("raw data");
  });

  it("b64 sanitizer strips non-base64 chars from image data", async () => {
    // A crafted image src containing a quote to test defense-in-depth
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "img()",
          outputs: [{ output_type: "display_data", data: { "image/png": 'abc" onerror="evil' } }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("xss.ipynb", host, makeDaemon({ content: nb }));
    const img = host.querySelector(".nb-img");
    expect(img).not.toBeNull();
    // The src should not contain quotes or spaces — only base64 chars survive
    expect(img!.getAttribute("src")).not.toContain('"');
    expect(img!.getAttribute("src")).not.toContain(" ");
  });

  it("handles cells array absent (non-array nb.cells)", async () => {
    const nb = JSON.stringify({ cells: null, metadata: {} });
    const host = document.createElement("div");
    // Should not throw — falls back to empty cells array
    await renderRichFile("no_cells.ipynb", host, makeDaemon({ content: nb }));
    expect(host.querySelector(".nb-doc")).not.toBeNull();
  });
});

// ── renderRichFile — pptx ─────────────────────────────────────────────────────

describe("renderRichFile — pptx", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a destroy function", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = await renderRichFile("deck.pptx", host, makeDaemon());
    expect(typeof cleanup).toBe("function");
    // Calling it should not throw
    expect(() => (cleanup as () => void)()).not.toThrow();
    host.remove();
  });

  it("creates frame and stage elements in host", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("deck.pptx", host, makeDaemon());
    expect(host.querySelector(".rich-slides-frame")).not.toBeNull();
    expect(host.querySelector(".rich-slides")).not.toBeNull();
    host.remove();
  });
});

// ── renderRichFile — drawio ───────────────────────────────────────────────────

describe("renderRichFile — drawio", () => {
  beforeEach(() => {
    // Reset the method spies on the shared graph instance between tests
    mockGraphInstance.setEnabled.mockReset();
    mockGraphInstance.setHtmlLabels.mockReset();
    mockGraphInstance.getDataModel.mockReset().mockReturnValue({});
    mockGraphInstance.getPlugin.mockReset().mockReturnValue({ fitCenter: vi.fn() });
    mockModelXmlSerializerInstance.import.mockReset();
  });

  it("returns a destroy function for a valid uncompressed drawio file", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = await renderRichFile("flow.drawio", host, makeDaemon({ content: DRAWIO_UNCOMPRESSED }));
    expect(typeof cleanup).toBe("function");
    expect(() => (cleanup as () => void)()).not.toThrow();
    host.remove();
  });

  it("creates frame and diagram elements in host", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("flow.drawio", host, makeDaemon({ content: DRAWIO_UNCOMPRESSED }));
    expect(host.querySelector(".rich-diagram-frame")).not.toBeNull();
    expect(host.querySelector(".rich-diagram")).not.toBeNull();
    host.remove();
  });

  it("shows error message for unparsable drawio XML", async () => {
    const host = document.createElement("div");
    await renderRichFile("bad.drawio", host, makeDaemon({ content: "<<not xml" }));
    expect(host.innerHTML).toContain("unsupported drawio format");
  });

  it("shows error message when diagram element has no model and no data", async () => {
    const xml = `<?xml version="1.0"?><mxfile><diagram></diagram></mxfile>`;
    const host = document.createElement("div");
    await renderRichFile("empty.drawio", host, makeDaemon({ content: xml }));
    expect(host.innerHTML).toContain("unsupported drawio format");
  });

  it("handles a bare mxGraphModel file (no mxfile wrapper)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = await renderRichFile("bare.drawio", host, makeDaemon({ content: DRAWIO_BARE_MODEL }));
    expect(typeof cleanup).toBe("function");
    host.remove();
  });

  it("sanitizes HTML labels: sets HTML mode when sanitization succeeds", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("labeled.drawio", host, makeDaemon({ content: DRAWIO_HTML_LABEL }));
    // setHtmlLabels should have been called with true (sanitization succeeded)
    expect(mockGraphInstance.setHtmlLabels).toHaveBeenCalledWith(true);
    host.remove();
  });

  it("handles compressed drawio format via pako inflate", async () => {
    // A <diagram> with base64 content but no child mxGraphModel triggers decompression
    const b64 = btoa(String.fromCharCode(...Array.from("payload", (c) => c.charCodeAt(0))));
    const xml = `<?xml version="1.0"?><mxfile><diagram>${b64}</diagram></mxfile>`;
    const { inflateRaw } = await import("pako");
    // Make pako return valid URL-encoded XML model
    const modelBytes = Array.from(encodeURIComponent("<mxGraphModel><root><mxCell id='0'/></root></mxGraphModel>"), (c) =>
      c.charCodeAt(0),
    );
    vi.mocked(inflateRaw).mockReturnValueOnce(new Uint8Array(modelBytes) as unknown as ReturnType<typeof inflateRaw>);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = await renderRichFile("compressed.drawio", host, makeDaemon({ content: xml }));
    expect(typeof cleanup).toBe("function");
    host.remove();
  });

  it("shows error when compressed drawio decompression fails", async () => {
    const b64 = btoa("garbage");
    const xml = `<?xml version="1.0"?><mxfile><diagram>${b64}</diagram></mxfile>`;
    const { inflateRaw } = await import("pako");
    vi.mocked(inflateRaw).mockImplementationOnce(() => {
      throw new Error("inflate fail");
    });
    const host = document.createElement("div");
    await renderRichFile("fail.drawio", host, makeDaemon({ content: xml }));
    expect(host.innerHTML).toContain("unsupported drawio format");
  });
});

// ── sanitizeDrawioLabels internal paths ───────────────────────────────────────
// These are exercised indirectly through renderRichFile/renderDrawio.
// The catch branch (line 94) requires DOMParser to throw, which we trigger by
// briefly patching DOMParser so the try block throws.

describe("sanitizeDrawioLabels — DOMParser exception path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renderDrawio still renders (returns destroy) when sanitizeDrawioLabels throws internally", async () => {
    // Patch DOMParser on the global to throw for one call (the XML parse inside
    // sanitizeDrawioLabels). The second call (in extractDrawioModel) must still work
    // so we only throw once.
    let callCount = 0;
    const OriginalDOMParser = globalThis.DOMParser;
    vi.stubGlobal("DOMParser", class {
      parseFromString(s: string, t: string) {
        callCount++;
        if (callCount === 2) throw new Error("parse error"); // second call = sanitize
        return new OriginalDOMParser().parseFromString(s, t as DOMParserSupportedType);
      }
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    // With safeXml = null, graph.setHtmlLabels should NOT be called
    const cleanup = await renderRichFile("throw.drawio", host, makeDaemon({ content: DRAWIO_UNCOMPRESSED }));
    expect(typeof cleanup).toBe("function");
    expect(mockGraphInstance.setHtmlLabels).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    host.remove();
  });
});

// ── docxFontFaces (lines 287–321) ─────────────────────────────────────────────
// Exercised via renderDocx → docxFontFaces. We populate jszipFileMap with real
// enough XML strings so the font extraction logic runs its inner branches.

describe("renderRichFile — docx with embedded fonts (docxFontFaces)", () => {
  afterEach(() => { jszipFileMap = {}; vi.clearAllMocks(); });

  it("injects a <style> element when a font is found via fontTable + rels", async () => {
    // Minimal fontTable.xml with one font and one embedRegular slot
    const fontTable = `
<w:fonts>
  <w:font w:name="TestFont">
    <w:embedRegular r:id="rId1" w:fontKey="{00000000-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId1" Target="fonts/TestFont-Regular.odttf"/>
</Relationships>`;
    // Tiny Uint8Array for the font bytes (32 bytes — enough for deobfuscation)
    const fontBytes = new Uint8Array(32).fill(0xaa);
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      "word/fonts/TestFont-Regular.odttf": jszipEntry(fontBytes),
    };
    const host = document.createElement("div");
    await renderRichFile("withfont.docx", host, makeDaemon());
    // A <style> with @font-face is prepended to host
    const style = host.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("@font-face");
    expect(style!.textContent).toContain("TestFont");
  });

  it("handles font target starting with / (absolute path in zip)", async () => {
    const fontTable = `
<w:fonts>
  <w:font w:name="SlashFont">
    <w:embedBold r:id="rId2" w:fontKey="{AAAAAAAA-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId2" Target="/word/fonts/Bold.odttf"/>
</Relationships>`;
    const fontBytes = new Uint8Array(32).fill(0xbb);
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      // Absolute path target → stripped to "word/fonts/Bold.odttf"
      "word/fonts/Bold.odttf": jszipEntry(fontBytes),
    };
    const host = document.createElement("div");
    await renderRichFile("slashpath.docx", host, makeDaemon());
    const style = host.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("SlashFont");
  });

  it("skips font slots where the relationship id is not in the rels map", async () => {
    const fontTable = `
<w:fonts>
  <w:font w:name="MissingRel">
    <w:embedRegular r:id="rIdMissing" w:fontKey="{00000000-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships></Relationships>`; // no matching relationship
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
    };
    const host = document.createElement("div");
    await renderRichFile("missingrel.docx", host, makeDaemon());
    // No style injected since font bytes were never loaded
    expect(host.querySelector("style")).toBeNull();
  });

  it("skips font slot when zip.file(path) returns null for the font file", async () => {
    const fontTable = `
<w:fonts>
  <w:font w:name="NullFont">
    <w:embedRegular r:id="rId3" w:fontKey="{00000000-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId3" Target="fonts/Null.odttf"/>
</Relationships>`;
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      // Font file itself is null → zip.file(p) returns null → skip
    };
    const host = document.createElement("div");
    await renderRichFile("nullfont.docx", host, makeDaemon());
    expect(host.querySelector("style")).toBeNull();
  });

  it("returns empty css when JSZip throws (catch branch)", async () => {
    const { default: JSZip } = await import("jszip");
    vi.mocked(JSZip.loadAsync).mockRejectedValueOnce(new Error("zip error"));
    const host = document.createElement("div");
    // Should not throw — catch returns { css: "", family: null }
    await expect(renderRichFile("broken.docx", host, makeDaemon())).resolves.not.toThrow();
  });

  it("applies document primary font via style attribute on article when family found", async () => {
    const fontTable = `
<w:fonts>
  <w:font w:name="PrimaryFont">
    <w:embedRegular r:id="rId10" w:fontKey="{BBBBBBBB-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId10" Target="fonts/Primary.odttf"/>
</Relationships>`;
    const fontBytes = new Uint8Array(32).fill(0x11);
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      "word/fonts/Primary.odttf": jszipEntry(fontBytes),
    };
    const host = document.createElement("div");
    await renderRichFile("primary.docx", host, makeDaemon());
    const article = host.querySelector<HTMLElement>(".rich-doc");
    expect(article).not.toBeNull();
    // style attribute should include the primary font family
    expect(article!.getAttribute("style")).toContain("PrimaryFont");
  });
});

// ── pptxFontFaces (lines 326–358) ─────────────────────────────────────────────

describe("renderRichFile — pptx with embedded fonts (pptxFontFaces)", () => {
  afterEach(() => { jszipFileMap = {}; vi.clearAllMocks(); });

  it("injects a <style> element in the frame when pptx has embedded fonts", async () => {
    const presXml = `
<p:presentation>
  <p:embeddedFontLst>
    <p:embeddedFont>
      <p:font typeface="SlideFont"/>
      <p:regular r:id="rId20"/>
    </p:embeddedFont>
  </p:embeddedFontLst>
</p:presentation>`;
    const rels = `<Relationships>
  <Relationship Id="rId20" Target="fonts/SlideFont.fntdata"/>
</Relationships>`;
    jszipFileMap = {
      "ppt/presentation.xml": jszipEntry(presXml),
      "ppt/_rels/presentation.xml.rels": jszipEntry(rels),
      "ppt/fonts/SlideFont.fntdata": jszipEntry("AAAA=="), // base64 font data
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("withfont.pptx", host, makeDaemon());
    const frame = host.querySelector<HTMLElement>(".rich-slides-frame")!;
    const style = frame.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("SlideFont");
    host.remove();
  });

  it("handles pptx font target with leading / (absolute path)", async () => {
    const presXml = `
<p:presentation>
  <p:embeddedFontLst>
    <p:embeddedFont>
      <p:font typeface="AbsFont"/>
      <p:bold r:id="rId21"/>
    </p:embeddedFont>
  </p:embeddedFontLst>
</p:presentation>`;
    const rels = `<Relationships>
  <Relationship Id="rId21" Target="/ppt/fonts/AbsFont-Bold.fntdata"/>
</Relationships>`;
    jszipFileMap = {
      "ppt/presentation.xml": jszipEntry(presXml),
      "ppt/_rels/presentation.xml.rels": jszipEntry(rels),
      "ppt/fonts/AbsFont-Bold.fntdata": jszipEntry("BBBB=="),
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("absfont.pptx", host, makeDaemon());
    const frame = host.querySelector<HTMLElement>(".rich-slides-frame")!;
    const style = frame.querySelector("style");
    expect(style).not.toBeNull();
    host.remove();
  });

  it("skips pptx font block with no typeface attribute", async () => {
    const presXml = `
<p:presentation>
  <p:embeddedFontLst>
    <p:embeddedFont>
      <p:regular r:id="rId22"/>
    </p:embeddedFont>
  </p:embeddedFontLst>
</p:presentation>`;
    const rels = `<Relationships>
  <Relationship Id="rId22" Target="fonts/NoName.fntdata"/>
</Relationships>`;
    jszipFileMap = {
      "ppt/presentation.xml": jszipEntry(presXml),
      "ppt/_rels/presentation.xml.rels": jszipEntry(rels),
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("notyp.pptx", host, makeDaemon());
    const frame = host.querySelector<HTMLElement>(".rich-slides-frame")!;
    expect(frame.querySelector("style")).toBeNull();
    host.remove();
  });

  it("skips pptx font slot when relationship is missing", async () => {
    const presXml = `
<p:presentation>
  <p:embeddedFontLst>
    <p:embeddedFont>
      <p:font typeface="NoRel"/>
      <p:regular r:id="rIdGone"/>
    </p:embeddedFont>
  </p:embeddedFontLst>
</p:presentation>`;
    const rels = `<Relationships></Relationships>`;
    jszipFileMap = {
      "ppt/presentation.xml": jszipEntry(presXml),
      "ppt/_rels/presentation.xml.rels": jszipEntry(rels),
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("norel.pptx", host, makeDaemon());
    const frame = host.querySelector<HTMLElement>(".rich-slides-frame")!;
    expect(frame.querySelector("style")).toBeNull();
    host.remove();
  });

  it("skips pptx font slot when zip.file returns null for the font file", async () => {
    const presXml = `
<p:presentation>
  <p:embeddedFontLst>
    <p:embeddedFont>
      <p:font typeface="NullFile"/>
      <p:italic r:id="rId23"/>
    </p:embeddedFont>
  </p:embeddedFontLst>
</p:presentation>`;
    const rels = `<Relationships>
  <Relationship Id="rId23" Target="fonts/NullFile.fntdata"/>
</Relationships>`;
    jszipFileMap = {
      "ppt/presentation.xml": jszipEntry(presXml),
      "ppt/_rels/presentation.xml.rels": jszipEntry(rels),
      // Font file not in map → zip.file returns null
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("nullfont.pptx", host, makeDaemon());
    const frame = host.querySelector<HTMLElement>(".rich-slides-frame")!;
    expect(frame.querySelector("style")).toBeNull();
    host.remove();
  });

  it("returns empty css when JSZip throws in pptxFontFaces (catch branch)", async () => {
    const { default: JSZip } = await import("jszip");
    vi.mocked(JSZip.loadAsync).mockRejectedValueOnce(new Error("zip error in pptx"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    await expect(renderRichFile("broken.pptx", host, makeDaemon())).resolves.not.toThrow();
    host.remove();
  });
});

// ── applyBundledFallback (lines 363–372) ──────────────────────────────────────
// Exercised via renderPptx which calls it after opening the viewer.
// We inject styled elements into the stage element to trigger all branches.

describe("renderRichFile — pptx applyBundledFallback branches", () => {
  afterEach(() => vi.clearAllMocks());

  it("appends var(--font-sans) fallback for non-embedded non-mono font", async () => {
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    // Have the renderer put a styled element in stage before we call applyBundledFallback
    vi.mocked(PptxViewer.open).mockImplementationOnce(async (_buf, stage: HTMLElement, _opts?) => {
      const span = document.createElement("span");
      span.style.fontFamily = "CustomFont";
      stage.appendChild(span);
      return { slideCount: 1, renderSlide: vi.fn(async () => {}), destroy: vi.fn() } as unknown as PptxViewer;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("sans.pptx", host, makeDaemon());
    const stage = host.querySelector<HTMLElement>(".rich-slides")!;
    const span = stage.querySelector<HTMLElement>("span")!;
    expect(span.style.fontFamily).toContain("var(--font-sans)");
    host.remove();
  });

  it("appends var(--font-mono) fallback for a monospace font name", async () => {
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockImplementationOnce(async (_buf, stage: HTMLElement, _opts?) => {
      const span = document.createElement("span");
      span.style.fontFamily = "Courier New";
      stage.appendChild(span);
      return { slideCount: 1, renderSlide: vi.fn(async () => {}), destroy: vi.fn() } as unknown as PptxViewer;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("mono.pptx", host, makeDaemon());
    const stage = host.querySelector<HTMLElement>(".rich-slides")!;
    const span = stage.querySelector<HTMLElement>("span")!;
    expect(span.style.fontFamily).toContain("var(--font-mono)");
    host.remove();
  });

  it("skips elements that already have var(--font fallback)", async () => {
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockImplementationOnce(async (_buf, stage: HTMLElement, _opts?) => {
      const span = document.createElement("span");
      span.style.fontFamily = "MyFont, var(--font-sans)";
      stage.appendChild(span);
      return { slideCount: 1, renderSlide: vi.fn(async () => {}), destroy: vi.fn() } as unknown as PptxViewer;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("already.pptx", host, makeDaemon());
    const stage = host.querySelector<HTMLElement>(".rich-slides")!;
    const span = stage.querySelector<HTMLElement>("span")!;
    // Should not double-append the fallback
    expect(span.style.fontFamily.match(/var\(--font/g)?.length).toBe(1);
    host.remove();
  });

  it("skips elements with empty fontFamily", async () => {
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockImplementationOnce(async (_buf, stage: HTMLElement, _opts?) => {
      const span = document.createElement("span");
      // Set the attribute but not inline style — querySelector('[style*=font-family]') won't match
      stage.appendChild(span);
      return { slideCount: 1, renderSlide: vi.fn(async () => {}), destroy: vi.fn() } as unknown as PptxViewer;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    // Should not throw when no elements have font-family
    await expect(renderRichFile("nofont.pptx", host, makeDaemon())).resolves.not.toThrow();
    host.remove();
  });

  it("skip element whose first font name is in embedded set", async () => {
    // pptxFontFaces returns an embedded set containing "EmbeddedFont"
    // so applyBundledFallback skips it, leaving the family unchanged
    const presXml = `
<p:presentation>
  <p:embeddedFontLst>
    <p:embeddedFont>
      <p:font typeface="EmbeddedFont"/>
      <p:regular r:id="rId30"/>
    </p:embeddedFont>
  </p:embeddedFontLst>
</p:presentation>`;
    const rels = `<Relationships>
  <Relationship Id="rId30" Target="fonts/Emb.fntdata"/>
</Relationships>`;
    jszipFileMap = {
      "ppt/presentation.xml": jszipEntry(presXml),
      "ppt/_rels/presentation.xml.rels": jszipEntry(rels),
      "ppt/fonts/Emb.fntdata": jszipEntry("CCCC=="),
    };
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockImplementationOnce(async (_buf, stage: HTMLElement, _opts?) => {
      const span = document.createElement("span");
      span.style.fontFamily = "EmbeddedFont";
      stage.appendChild(span);
      return { slideCount: 1, renderSlide: vi.fn(async () => {}), destroy: vi.fn() } as unknown as PptxViewer;
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("embedded.pptx", host, makeDaemon());
    const stage = host.querySelector<HTMLElement>(".rich-slides")!;
    const span = stage.querySelector<HTMLElement>("span")!;
    // Unchanged — embedded font, no fallback appended
    expect(span.style.fontFamily).toBe("EmbeddedFont");
    host.remove();
  });
});

// ── pptx nav / slide navigation (lines 399–407) ──────────────────────────────

describe("renderRichFile — pptx slide navigation", () => {
  afterEach(() => vi.clearAllMocks());

  it("mountViewport is called with nav prev/next/label, and nav.next triggers renderSlide", async () => {
    const renderSlide = vi.fn(async () => {});
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockResolvedValueOnce({
      slideCount: 5,
      renderSlide,
      destroy: vi.fn(),
    } as unknown as PptxViewer);
    const { mountViewport } = await import("./richviewport");
    let capturedNav: { prev(): void; next(): void; label(): string } | undefined;
    vi.mocked(mountViewport).mockImplementationOnce((_frame, _content, opts) => {
      capturedNav = opts?.nav;
      return { destroy: vi.fn(), refreshLabel: vi.fn() };
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("nav.pptx", host, makeDaemon());
    expect(capturedNav).toBeDefined();
    // Navigate forward
    capturedNav!.next();
    await Promise.resolve(); // flush the renderSlide promise
    expect(renderSlide).toHaveBeenCalledWith(1);
    // Label returns "2 / 5" (cur=1, count=5)
    expect(capturedNav!.label()).toBe("2 / 5");
    // Navigate back
    capturedNav!.prev();
    await Promise.resolve();
    expect(capturedNav!.label()).toBe("1 / 5");
    host.remove();
  });

  it("slide index is clamped — prev from slide 0 stays at 0", async () => {
    const renderSlide = vi.fn(async () => {});
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockResolvedValueOnce({
      slideCount: 3,
      renderSlide,
      destroy: vi.fn(),
    } as unknown as PptxViewer);
    const { mountViewport } = await import("./richviewport");
    let capturedNav: { prev(): void; next(): void; label(): string } | undefined;
    vi.mocked(mountViewport).mockImplementationOnce((_frame, _content, opts) => {
      capturedNav = opts?.nav;
      return { destroy: vi.fn(), refreshLabel: vi.fn() };
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("clamp.pptx", host, makeDaemon());
    // At slide 0, go prev → stays at 0
    capturedNav!.prev();
    await Promise.resolve();
    expect(renderSlide).toHaveBeenLastCalledWith(0);
    expect(capturedNav!.label()).toBe("1 / 3");
    host.remove();
  });

  it("destroy calls both handle.destroy and viewer.destroy", async () => {
    const viewerDestroy = vi.fn();
    const handleDestroy = vi.fn();
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    vi.mocked(PptxViewer.open).mockResolvedValueOnce({
      slideCount: 1,
      renderSlide: vi.fn(async () => {}),
      destroy: viewerDestroy,
    } as unknown as PptxViewer);
    const { mountViewport } = await import("./richviewport");
    vi.mocked(mountViewport).mockImplementationOnce(() => ({ destroy: handleDestroy, refreshLabel: vi.fn() }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = await renderRichFile("destroy.pptx", host, makeDaemon()) as () => void;
    cleanup();
    expect(handleDestroy).toHaveBeenCalled();
    expect(viewerDestroy).toHaveBeenCalled();
    host.remove();
  });
});

// ── ipynb — unknown output_type produces empty string (line 209) ──────────────

describe("renderRichFile — ipynb unknown output_type", () => {
  it("silently ignores outputs with an unknown output_type", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "x = 1",
          outputs: [{ output_type: "unknown_type", data: {} }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("unknown_out.ipynb", host, makeDaemon({ content: nb }));
    // Cell renders (source present), but unknown output contributes nothing
    expect(host.querySelector(".nb-cell")).not.toBeNull();
  });

  it("empty code cell with non-empty outs still renders the outputs", async () => {
    // Branch 32 line 222: `if (!code.trim() && !outs) return ""` — when code
    // is empty but outs is non-empty the cell should render just the outputs.
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "",
          outputs: [{ output_type: "stream", text: "output only" }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("empty_code_with_out.ipynb", host, makeDaemon({ content: nb }));
    expect(host.querySelector(".nb-out")).not.toBeNull();
    // No <code> block since source was empty
    expect(host.querySelector("code")).toBeNull();
  });

  it("str() helper treats undefined as empty string (branch 16 line 187)", async () => {
    // A cell with source: undefined — str(undefined) should return ""
    const nb = JSON.stringify({
      cells: [{ cell_type: "code", source: undefined, outputs: [] }],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("undef_source.ipynb", host, makeDaemon({ content: nb }));
    // Empty source → no nb-cell (empty code, no outs)
    expect(host.querySelector(".nb-cell")).toBeNull();
  });

  it("error output with undefined traceback uses empty array fallback (branch 20)", async () => {
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "x",
          outputs: [{ output_type: "error" }], // no traceback field
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("no_traceback.ipynb", host, makeDaemon({ content: nb }));
    // Should render an empty error block without throwing
    expect(host.querySelector(".nb-err")).not.toBeNull();
  });

  it("execute_result with no recognised data mime type returns empty string (branches 23, 27)", async () => {
    // data exists (branch 23 true: `o.data ?? {}` uses o.data) but has no
    // image/png, jpeg, text/html, or text/plain → all inner ifs are false
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "x",
          outputs: [{ output_type: "execute_result", data: { "application/json": '{"x":1}' } }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("no_mime.ipynb", host, makeDaemon({ content: nb }));
    // Cell with source renders but output produces nothing visible
    expect(host.querySelector(".nb-cell")).not.toBeNull();
  });
});

// ── isRichFile — path with no extension (branch 0 line 19) ───────────────────

describe("isRichFile / ext — no-dot path (pop() ?? fallback)", () => {
  it("handles a path with no dots (pop returns undefined, ?? gives empty string)", () => {
    // "noext".split(".").pop() === "noext" actually — need a path that returns
    // undefined: split(".")  on empty string gives [""], pop()=="" which is truthy.
    // The ?? branch fires only if pop() returns undefined — that can't happen with
    // split("."). So branch 0 is genuinely unreachable (TypeScript says pop() may
    // be undefined; JS guarantees it's not for split result). Document this.
    // We call isRichFile with edge-case paths to maximise statement coverage:
    expect(isRichFile("")).toBe(false); // empty string
    expect(richLabel("")).toBe("File");  // unknown ext
  });
});

// ── sanitizeDrawioLabels — parsererror branch and plain-text value branch ─────

describe("sanitizeDrawioLabels branches via renderDrawio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockGraphInstance.setEnabled.mockReset();
    mockGraphInstance.setHtmlLabels.mockReset();
    mockGraphInstance.getDataModel.mockReset().mockReturnValue({});
    mockGraphInstance.getPlugin.mockReset().mockReturnValue({ fitCenter: vi.fn() });
    mockModelXmlSerializerInstance.import.mockReset();
  });

  it("parseerror XML: DOMParser returns a parsererror doc → safeXml is null, HTML labels off", async () => {
    // Feed mxGraphModel XML that contains a value with an &amp; to survive XML
    // parsing as valid XML, but then pass an mxfile where the inner diagram
    // contains valid XML yet the sanitize XML parses with parsererror.
    // Easiest: stub DOMParser so the SECOND call (sanitizeDrawioLabels) returns
    // a doc containing a parsererror element.
    const OriginalDOMParser = globalThis.DOMParser;
    let callCount = 0;
    vi.stubGlobal("DOMParser", class {
      parseFromString(s: string, t: string) {
        callCount++;
        if (callCount === 2) {
          // Return a document with a parsererror element
          return new OriginalDOMParser().parseFromString("<<invalid>>", "text/xml");
        }
        return new OriginalDOMParser().parseFromString(s, t as DOMParserSupportedType);
      }
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("parseerr.drawio", host, makeDaemon({ content: DRAWIO_UNCOMPRESSED }));
    // safeXml = null → setHtmlLabels should NOT be called
    expect(mockGraphInstance.setHtmlLabels).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    host.remove();
  });

  it("value attribute with plain text (no tags) skips DOMPurify (branch 5 false path)", async () => {
    // Drawio XML where [value] exists but contains plain text without any tags
    const plainLabelXml = `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel>
  <root><mxCell id="0" value="Just plain text A &lt; B"/></root>
</mxGraphModel></diagram></mxfile>`;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = await renderRichFile("plain.drawio", host, makeDaemon({ content: plainLabelXml }));
    // No error — sanitization ran but plain-text value branch (no tags) was skipped
    expect(typeof cleanup).toBe("function");
    host.remove();
  });
});

// ── fontFaceRule italic branch + deobfuscateOdttf short-circuit ──────────────

describe("docxFontFaces — italic font + short GUID (branch 35, 36)", () => {
  afterEach(() => { jszipFileMap = {}; vi.clearAllMocks(); });

  it("injects italic font face (fontFaceRule italic=true branch)", async () => {
    // embedItalic slot exercises: bold=false, italic=true in fontFaceRule
    const fontTable = `
<w:fonts>
  <w:font w:name="ItalicFont">
    <w:embedItalic r:id="rId50" w:fontKey="{CCCCCCCC-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId50" Target="fonts/ItalicFont-Italic.odttf"/>
</Relationships>`;
    const fontBytes = new Uint8Array(32).fill(0xee);
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      "word/fonts/ItalicFont-Italic.odttf": jszipEntry(fontBytes),
    };
    const host = document.createElement("div");
    await renderRichFile("italic.docx", host, makeDaemon());
    const style = host.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("font-style:italic");
  });

  it("injects bold+italic font face (embedBoldItalic slot)", async () => {
    const fontTable = `
<w:fonts>
  <w:font w:name="BoldItalicFont">
    <w:embedBoldItalic r:id="rId51" w:fontKey="{DDDDDDDD-0000-0000-0000-000000000000}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId51" Target="fonts/BoldItalic.odttf"/>
</Relationships>`;
    const fontBytes = new Uint8Array(32).fill(0xff);
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      "word/fonts/BoldItalic.odttf": jszipEntry(fontBytes),
    };
    const host = document.createElement("div");
    await renderRichFile("bolditalic.docx", host, makeDaemon());
    const style = host.querySelector("style");
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("font-weight:700");
    expect(style!.textContent).toContain("font-style:italic");
  });

  it("deobfuscateOdttf returns bytes unchanged when GUID hex is too short (branch 36)", async () => {
    // fontKey with a short/stripped GUID → hex.length < 32 → returns bytes as-is
    const fontTable = `
<w:fonts>
  <w:font w:name="ShortGuid">
    <w:embedRegular r:id="rId52" w:fontKey="{short}"/>
  </w:font>
</w:fonts>`;
    const rels = `<Relationships>
  <Relationship Id="rId52" Target="fonts/Short.odttf"/>
</Relationships>`;
    const fontBytes = new Uint8Array(32).fill(0xab);
    jszipFileMap = {
      "word/fontTable.xml": jszipEntry(fontTable),
      "word/_rels/fontTable.xml.rels": jszipEntry(rels),
      "word/fonts/Short.odttf": jszipEntry(fontBytes),
    };
    const host = document.createElement("div");
    // Should complete without error — bytes returned unchanged
    await expect(renderRichFile("shortguid.docx", host, makeDaemon())).resolves.not.toThrow();
    // Font is still embedded (bytes were not XOR'd but still encoded)
    const style = host.querySelector("style");
    expect(style).not.toBeNull();
  });
});

// ── drawio error-path return closure + fitGraph callback ─────────────────────
// These cover anonymous_33 (the `() => {}` returned when modelXml is null) and
// anonymous_34 (fitGraph passed as onFit to mountViewport).

describe("renderRichFile — drawio anonymous function coverage", () => {
  beforeEach(() => {
    mockGraphInstance.setEnabled.mockReset();
    mockGraphInstance.setHtmlLabels.mockReset();
    mockGraphInstance.getDataModel.mockReset().mockReturnValue({});
    mockGraphInstance.getPlugin.mockReset().mockReturnValue({ fitCenter: vi.fn() });
    mockModelXmlSerializerInstance.import.mockReset();
  });

  it("the no-op destroy returned for an invalid drawio can be called without error", async () => {
    const host = document.createElement("div");
    // Invalid XML → modelXml null → `return () => {}` is returned
    const cleanup = await renderRichFile("bad.drawio", host, makeDaemon({ content: "<<bad" })) as () => void;
    // Calling the returned no-op must not throw (fn 33, line 423)
    expect(() => cleanup()).not.toThrow();
  });

  it("onFit callback (fitGraph) is invoked when fit button is clicked", async () => {
    // Override mountViewport to capture and invoke the onFit callback immediately
    const { mountViewport } = await import("./richviewport");
    let capturedOnFit: (() => void) | undefined;
    vi.mocked(mountViewport).mockImplementationOnce((_frame, _content, opts) => {
      capturedOnFit = opts?.onFit;
      return { destroy: vi.fn(), refreshLabel: vi.fn() };
    });
    const fitCenter = vi.fn();
    mockGraphInstance.getPlugin.mockReturnValue({ fitCenter });
    const host = document.createElement("div");
    document.body.appendChild(host);
    await renderRichFile("fit.drawio", host, makeDaemon({ content: DRAWIO_UNCOMPRESSED }));
    expect(capturedOnFit).toBeDefined();
    // Calling onFit should invoke fitPlugin.fitCenter (fn 34, line 447)
    capturedOnFit!();
    expect(fitCenter).toHaveBeenCalledWith({ border: 8 });
    host.remove();
  });
});

// ── ipynb — execute_result with data: null (branch 23 line 203) ──────────────

describe("renderRichFile — ipynb execute_result with null data", () => {
  it("execute_result where data is null falls back to empty object", async () => {
    // branch 23: `o.data ?? {}` — when data is null the ?? fires
    const nb = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: "x",
          outputs: [{ output_type: "execute_result", data: null }],
        },
      ],
      metadata: {},
    });
    const host = document.createElement("div");
    await renderRichFile("null_data.ipynb", host, makeDaemon({ content: nb }));
    // No crash; cell renders but no output element
    expect(host.querySelector(".nb-cell")).not.toBeNull();
    expect(host.querySelector(".nb-img")).toBeNull();
  });
});
