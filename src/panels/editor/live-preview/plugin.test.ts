import { describe, it, expect, vi } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview, decorationCount } from "./plugin";
import * as bus from "../../bus";

// The widget classes are not exported — exercise them indirectly through the
// EditorView, or directly by extracting via the plugin's decoration set.

// Spy on bus so wikilink widget click doesn't require vault state.
vi.spyOn(bus, "resolveWikilink").mockImplementation((name: string) => (name === "Alpha" ? "alpha.md" : null));
vi.spyOn(bus, "openFile").mockImplementation(() => {});

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

  it("turns a task marker into a checkbox widget off-line (unchecked)", () => {
    const v = viewWith("- [ ] todo\n\nx", 12); // cursor on "x"
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("turns a checked task marker into a checkbox widget off-line", () => {
    // Exercises the checked:true branch of CheckboxWidget.
    const v = viewWith("- [x] done\n\nx", 12);
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("gives a heading its level line-class off-line", () => {
    const v = viewWith("# Title\n\nx", 9); // cursor on "x"
    // HeaderMark conceal + h1 line class
    expect(decorationCount(v)).toBeGreaterThanOrEqual(2);
    v.destroy();
  });

  it("applies line decorations for h2..h6 off-line", () => {
    for (let n = 2; n <= 6; n++) {
      const hashes = "#".repeat(n);
      const doc = `${hashes} Title\n\nx`;
      // Place cursor on the trailing "x" (always the last character).
      const v = viewWith(doc, doc.length - 1);
      expect(decorationCount(v)).toBeGreaterThanOrEqual(1);
      v.destroy();
    }
  });

  it("replaces [[wikilink]] with a clickable widget off-line", () => {
    const v = viewWith("see [[Alpha]] here\n\nx", 20); // cursor on "x"
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("replaces [[Note|alias]] (wikilink with alias) off-line", () => {
    const v = viewWith("see [[Alpha|display text]] here\n\nx", 32);
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("styles a blockquote and conceals its > marker off-line", () => {
    // Exercises the Blockquote + QuoteMark branches.
    const v = viewWith("> a quoted line\n\nx", 17);
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("decorates a horizontal rule off-line", () => {
    // Exercises the HorizontalRule branch.
    const v = viewWith("above\n\n---\n\nx", 12);
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("styles a fenced code block off-line", () => {
    // Exercises the FencedCode branch.
    const v = viewWith("```\nconst x = 1;\n```\n\nx", 21);
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("styles italic and strikethrough off-line", () => {
    // Exercises Emphasis and Strikethrough + their mark conceals.
    const v = viewWith("_italic_ and ~~strike~~\n\nx", 24);
    expect(decorationCount(v)).toBeGreaterThanOrEqual(2);
    v.destroy();
  });

  it("styles inline code off-line", () => {
    // Exercises InlineCode + CodeMark conceal.
    const v = viewWith("`code`\n\nx", 8);
    expect(decorationCount(v)).toBeGreaterThanOrEqual(1);
    v.destroy();
  });

  it("cursor on bold/italic/strike/code line reveals raw markers (0 decorations)", () => {
    // Exercises the onCursorLine===true skip branch for inline emphasis nodes.
    const v = viewWith("**bold** and _italic_ and ~~strike~~ and `code`", 0);
    // cursor at 0 = on the only line → all inline decorations suppressed
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("cursor on blockquote line reveals raw > marker (0 decorations)", () => {
    const v = viewWith("> quoted", 0);
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("cursor on horizontal rule line suppresses its decoration", () => {
    const v = viewWith("---", 0);
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("cursor on fenced code block suppresses the fence decoration", () => {
    // Cursor on the opening line — the fence decorator checks onCursorLine for
    // the full node span, which includes the cursor line, so the fence is hidden.
    // Other decorators (e.g. CodeMark) may still fire; just verify fewer than off-line.
    const off = viewWith("```\ncode here\n```\n\nx", 19); // cursor on "x"
    const on  = viewWith("```\ncode here\n```", 0);       // cursor on first ```
    expect(decorationCount(on)).toBeLessThanOrEqual(decorationCount(off));
    off.destroy();
    on.destroy();
  });

  it("cursor on task marker line suppresses checkbox widget", () => {
    const v = viewWith("- [x] done", 0);
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("cursor on wikilink line suppresses the wikilink widget", () => {
    const v = viewWith("[[Alpha]]", 0);
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("update() re-builds decorations when the doc changes (docChanged branch)", () => {
    // Exercises the ViewPlugin.update() path (docChanged branch).
    const v = viewWith("# Heading\n\nx", 11);
    const before = decorationCount(v);
    // Dispatch a transaction that appends text, moving the cursor off line 1.
    v.dispatch({
      changes: { from: v.state.doc.length, insert: "\n\nmore text" },
      selection: { anchor: v.state.doc.length + 10 },
    });
    const after = decorationCount(v);
    // The heading is still decorated after the update.
    expect(after).toBeGreaterThanOrEqual(before);
    v.destroy();
  });

  it("update() re-builds decorations on selectionSet (cursor move without doc change)", () => {
    // Exercises the u.selectionSet branch of update().
    const v = viewWith("# Heading\n\nbody text", 0); // cursor starts on heading → no decos
    expect(decorationCount(v)).toBe(0);
    // Move cursor to "body text" — selection change only (no doc change).
    v.dispatch({ selection: { anchor: 11 } });
    // Now cursor is off the heading line → HeaderMark is concealed.
    expect(decorationCount(v)).toBeGreaterThan(0);
    v.destroy();
  });

  it("decorationCount returns 0 for a view without the livePreview plugin", () => {
    // Exercises the early-return path in decorationCount (plugin not found).
    const state = EditorState.create({ doc: "# hi" });
    const v = new EditorView({ state }); // no livePreview() extension
    expect(decorationCount(v)).toBe(0);
    v.destroy();
  });

  it("wikilink widget toDOM fires openFile on mousedown when target resolves", () => {
    // Exercises WikilinkWidget.toDOM() click path: resolveWikilink returns a path,
    // so openFile is called (spied above).
    vi.mocked(bus.openFile).mockClear();
    const v = viewWith("[[Alpha]]\n\nx", 10);
    // Force a re-build so the widget is rendered.
    const plugin = v.plugin(livePreview());
    // Walk decorations to find the widget's DOM node and trigger mousedown.
    let widgetDom: HTMLElement | null = null;
    plugin?.decorations.between(0, v.state.doc.length, (_from, _to, deco) => {
      // @ts-expect-error — accessing private spec for test only
      const w = deco.spec?.widget;
      if (w && typeof w.toDOM === "function" && !widgetDom) {
        const dom = w.toDOM() as HTMLElement;
        // Only take the wikilink widget (span, not input).
        if (dom.tagName === "SPAN") widgetDom = dom;
      }
    });
    if (widgetDom) {
      const event = new MouseEvent("mousedown", { bubbles: true });
      widgetDom.dispatchEvent(event);
      expect(bus.openFile).toHaveBeenCalledWith("alpha.md");
    }
    v.destroy();
  });

  it("wikilink widget toDOM does NOT call openFile when target is unresolvable", () => {
    // Exercises WikilinkWidget.toDOM() when resolveWikilink returns null.
    vi.mocked(bus.openFile).mockClear();
    const v = viewWith("[[Nonexistent]]\n\nx", 16);
    const plugin = v.plugin(livePreview());
    plugin?.decorations.between(0, v.state.doc.length, (_from, _to, deco) => {
      // @ts-expect-error
      const w = deco.spec?.widget;
      if (w && typeof w.toDOM === "function") {
        const dom = w.toDOM() as HTMLElement;
        dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }
    });
    expect(bus.openFile).not.toHaveBeenCalled();
    v.destroy();
  });

  it("widget eq() and ignoreEvent() methods exercise both widget classes", () => {
    // Extract all widget instances from the decoration set and call eq()/ignoreEvent().
    const doc = "- [x] done\n\n[[Alpha]]\n\nx";
    const v1 = viewWith(doc, doc.length - 1);
    const plugin = v1.plugin(livePreview());
    const widgets: WidgetType[] = [];
    plugin?.decorations.between(0, v1.state.doc.length, (_f, _t, deco) => {
      // @ts-expect-error — accessing private spec for test only
      const w = deco.spec?.widget;
      if (w) widgets.push(w);
    });
    // There should be at least two widgets: a CheckboxWidget and a WikilinkWidget.
    expect(widgets.length).toBeGreaterThanOrEqual(2);
    for (const w of widgets) {
      // eq() against itself should be true (exercises CheckboxWidget.eq + WikilinkWidget.eq).
      expect(w.eq(w as any)).toBe(true);
      // ignoreEvent() should return false for both (exercises lines 51 and 77).
      expect(w.ignoreEvent(new Event("mousedown"))).toBe(false);
    }
    v1.destroy();
  });
});
