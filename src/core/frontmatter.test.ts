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
});
