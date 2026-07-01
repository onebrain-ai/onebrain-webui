import { describe, it, expect, vi } from "vitest";
import { formatCode, formatXml } from "./codeformat";

// js-yaml is dynamically imported inside formatCode — mock it so tests are fast
// and self-contained (no real YAML parser needed).
vi.mock("js-yaml", async (orig) => {
  const real = await orig<typeof import("js-yaml")>();
  return {
    ...real,
    // Use the real implementation so YAML round-trips are tested accurately.
  };
});

describe("formatCode() — JSON / JSONC", () => {
  it("pretty-prints valid JSON", async () => {
    const out = await formatCode("json", '{"a":1,"b":2}');
    expect(out).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  it("pretty-prints JSONC (same path as json)", async () => {
    const out = await formatCode("jsonc", '{"x":true}');
    expect(out).toBe(JSON.stringify({ x: true }, null, 2));
  });

  it("returns malformed JSON unchanged (never throws)", async () => {
    const bad = "{not json}";
    expect(await formatCode("json", bad)).toBe(bad);
  });

  it("is case-insensitive on lang (JSON → json)", async () => {
    const out = await formatCode("JSON", '{"a":1}');
    expect(out).toBe(JSON.stringify({ a: 1 }, null, 2));
  });
});

describe("formatCode() — YAML / YML", () => {
  it("pretty-prints a single-document YAML", async () => {
    const src = "a: 1\nb: 2\n";
    const out = await formatCode("yaml", src);
    // The output must contain the key-value pairs (round-tripped through js-yaml).
    expect(out).toContain("a: 1");
    expect(out).toContain("b: 2");
  });

  it("accepts yml alias", async () => {
    const out = await formatCode("yml", "key: value\n");
    expect(out).toContain("key: value");
  });

  it("handles multi-document YAML (--- separator)", async () => {
    const src = "a: 1\n---\nb: 2\n";
    const out = await formatCode("yaml", src);
    expect(out).toContain("a: 1");
    expect(out).toContain("b: 2");
  });

  it("returns malformed YAML unchanged", async () => {
    const bad = "a: [\nunclosed";
    const out = await formatCode("yaml", bad);
    expect(out).toBe(bad);
  });
});

describe("formatCode() — XML family", () => {
  it("pretty-prints well-formed XML", async () => {
    const src = "<root><child>text</child></root>";
    const out = await formatCode("xml", src);
    expect(out).toContain("<root>");
    expect(out).toContain("  <child>text</child>");
  });

  it("accepts xsd, xsl, rss, plist aliases", async () => {
    const src = "<root/>";
    for (const lang of ["xsd", "xsl", "rss", "plist"]) {
      const out = await formatCode(lang, src);
      expect(out).toContain("<root");
    }
  });

  it("returns malformed XML unchanged (parse error)", async () => {
    const bad = "<unclosed";
    const out = await formatCode("xml", bad);
    expect(out).toBe(bad);
  });
});

describe("formatCode() — passthrough for unsupported langs", () => {
  it("returns the text unchanged for 'ts'", async () => {
    const src = "const x = 1;";
    expect(await formatCode("ts", src)).toBe(src);
  });

  it("returns the text unchanged for an empty lang", async () => {
    const src = "anything";
    expect(await formatCode("", src)).toBe(src);
  });

  it("returns the text unchanged for 'python'", async () => {
    const src = "def foo(): pass";
    expect(await formatCode("python", src)).toBe(src);
  });
});

describe("formatXml()", () => {
  it("indents a simple element tree", () => {
    const out = formatXml("<root><a><b>text</b></a></root>");
    expect(out).toContain("<root>");
    expect(out).toContain("  <a>");
    expect(out).toContain("    <b>text</b>");
    expect(out).toContain("</root>");
  });

  it("self-closes an empty element (no text, no children)", () => {
    const out = formatXml("<root><empty/></root>");
    expect(out).toContain("<empty />");
  });

  it("preserves attributes", () => {
    const out = formatXml('<root id="1"><child class="x">val</child></root>');
    expect(out).toContain('id="1"');
    expect(out).toContain('class="x"');
  });

  it("returns malformed XML unchanged", () => {
    const bad = "<unclosed";
    expect(formatXml(bad)).toBe(bad);
  });

  it("handles an element with text content", () => {
    const out = formatXml("<root><item>hello world</item></root>");
    expect(out).toContain("<item>hello world</item>");
  });

  it("handles mixed text + element children (text is collected)", () => {
    // DOMParser puts text nodes alongside element children; the serialiser
    // prioritises element children when els.length > 0.
    const out = formatXml("<root><a>1</a><b>2</b></root>");
    expect(out).toContain("<a>1</a>");
    expect(out).toContain("<b>2</b>");
  });
});
