import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { livePreview, decorationCount } from "./plugin";

function viewWith(doc: string, cursor: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown(), livePreview()],
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
});
