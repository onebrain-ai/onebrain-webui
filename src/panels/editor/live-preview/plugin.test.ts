import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview, decorationCount } from "./plugin";

function viewWith(doc: string, cursor: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage }), livePreview()],
  });
  return new EditorView({ state });
}

describe("livePreview", () => {
  it("decorates a heading marker when the cursor is elsewhere", () => {
    const v = viewWith("# Title\n\nbody", 10); // cursor on "body"
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("reveals raw markup on the cursor's own line", () => {
    const v = viewWith("# Title", 2); // cursor inside the heading line
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("styles bold and conceals its ** markers off-line", () => {
    const v = viewWith("a **bold** b\n\nx", 14); // cursor on "x"
    // two EmphasisMark conceals (open + close) + one StrongEmphasis style mark
    expect(decorationCount(v)).toBeGreaterThanOrEqual(2);
    v.destroy();
  });

  it("turns a task marker into a checkbox widget off-line", () => {
    const v = viewWith("- [ ] todo\n\nx", 12); // cursor on "x"
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("gives a heading its level line-class off-line", () => {
    const v = viewWith("# Title\n\nx", 9); // cursor on "x"
    // HeaderMark conceal + h1 line class
    expect(decorationCount(v)).toBeGreaterThanOrEqual(2);
    v.destroy();
  });
});
