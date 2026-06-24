import { describe, it, expect } from "vitest";
import { splitMatch, tailPath } from "./explorer";

describe("splitMatch", () => {
  it("splits a name around the first case-insensitive hit", () => {
    expect(splitMatch("oneide-architecture.md", "oneide")).toEqual(["", "oneide", "-architecture.md"]);
    expect(splitMatch("OneIDE.md", "oneide")).toEqual(["", "OneIDE", ".md"]);
    expect(splitMatch("my-oneide-note.md", "oneide")).toEqual(["my-", "oneide", "-note.md"]);
  });
  it("returns null when the query is absent (matched the path, not the name)", () => {
    expect(splitMatch("readme.md", "oneide")).toBeNull();
    expect(splitMatch("anything", "")).toBeNull();
  });
});

describe("tailPath", () => {
  it("keeps the last two segments and flags when it clipped ancestors", () => {
    expect(tailPath("01-projects/oneide/design")).toEqual({ text: "oneide/design", clipped: true, root: false });
    expect(tailPath("01-projects/oneide")).toEqual({ text: "01-projects/oneide", clipped: false, root: false });
    expect(tailPath("inbox")).toEqual({ text: "inbox", clipped: false, root: false });
  });
  it("flags a vault-root file via the empty-string sentinel (not a folder named 'root')", () => {
    expect(tailPath("")).toEqual({ text: "", clipped: false, root: true });
    expect(tailPath("root")).toEqual({ text: "root", clipped: false, root: false });
  });
});
