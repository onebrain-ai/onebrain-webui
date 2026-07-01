import { describe, it, expect } from "vitest";
import { splitNote, parseFrontmatter, compose } from "./frontmatter";

describe("frontmatter", () => {
  it("splits a leading --- block off the body", () => {
    const s = "---\ntags: [a]\n---\n# Body\n";
    expect(splitNote(s)).toEqual({ raw: "tags: [a]", body: "# Body\n" });
  });

  it("returns raw=null when there is no frontmatter", () => {
    expect(splitNote("# Body")).toEqual({ raw: null, body: "# Body" });
  });

  it("parses YAML frontmatter into an object", () => {
    expect(parseFrontmatter("tags: [a, b]\ncreated: 2026-06-08")).toMatchObject({ tags: ["a", "b"] });
  });

  it("keeps date-like scalars as strings (no Date coercion)", () => {
    // DEFAULT_SCHEMA would coerce these to JS Date (renders as a locale string in
    // the properties form, re-serializes to a full ISO timestamp). CORE_SCHEMA keeps
    // them as the verbatim source string.
    const obj = parseFrontmatter("created: 2026-03-10\nupdated: 2026-03-18");
    expect(obj.created).toBe("2026-03-10");
    expect(obj.updated).toBe("2026-03-18");
    expect(obj.created).not.toBeInstanceOf(Date);
  });

  it("re-serializes a date string back to the same unquoted scalar", () => {
    const out = compose({ raw: "created: 2026-03-10", obj: { created: "2026-03-10" }, edited: true }, "# Body\n");
    expect(out).toContain("created: 2026-03-10");
    expect(out).not.toMatch(/T00:00:00/); // not an ISO timestamp
  });

  it("preserves raw bytes when the form was NOT edited", () => {
    const raw = "tags:   [a]\ncreated: 2026-06-08"; // odd spacing on purpose
    expect(compose({ raw, obj: {}, edited: false }, "# Body\n")).toBe(`---\n${raw}\n---\n# Body\n`);
  });

  it("re-serializes when the form WAS edited", () => {
    const out = compose({ raw: "tags: [a]", obj: { tags: ["a", "b"] }, edited: true }, "# Body\n");
    expect(out).toContain("- b");
    expect(out.startsWith("---\n")).toBe(true);
  });

  it("body-only note with no frontmatter composes to just the body", () => {
    expect(compose({ raw: null, obj: {}, edited: false }, "# Body")).toBe("# Body");
  });

  // parseFrontmatter line 37-39: non-object YAML (array / scalar / null) → {}
  it("parseFrontmatter returns {} for non-object YAML (array at top level)", () => {
    // A bare YAML list is valid YAML but not a frontmatter object.
    expect(parseFrontmatter("- a\n- b")).toEqual({});
  });

  it("parseFrontmatter returns {} for a scalar string", () => {
    expect(parseFrontmatter("just a string")).toEqual({});
  });

  it("parseFrontmatter returns {} for null input", () => {
    expect(parseFrontmatter(null)).toEqual({});
  });

  // compose line 58: edited=true but obj is empty → body only (no fence emitted).
  it("compose with edited=true and empty obj emits just the body (no empty fence)", () => {
    const out = compose({ raw: "tags: [a]", obj: {}, edited: true }, "# Body");
    expect(out).toBe("# Body");
    expect(out).not.toContain("---");
  });

  // splitNote with CRLF frontmatter fence.
  it("splitNote handles CRLF line endings in the frontmatter fence", () => {
    const src = "---\r\ntitle: Hi\r\n---\r\n# Body\n";
    const { raw, body } = splitNote(src);
    expect(raw).toBe("title: Hi");
    expect(body).toContain("# Body");
  });
});
