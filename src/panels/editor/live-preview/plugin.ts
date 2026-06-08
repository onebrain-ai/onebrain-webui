import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";

/** Replace a range with nothing (conceal). */
const conceal = Decoration.replace({});

/** Inline-emphasis style marks (applied to the whole span, delimiters concealed). */
const styleBold = Decoration.mark({ class: "cm-lp-strong" });
const styleItalic = Decoration.mark({ class: "cm-lp-em" });
const styleStrike = Decoration.mark({ class: "cm-lp-strike" });
const styleCode = Decoration.mark({ class: "cm-lp-code" });

/** Is byte range [from,to] on the same line as any cursor? (Live preview reveals
 *  raw source on the active line, Obsidian-style.) */
function onCursorLine(view: EditorView, from: number, to: number): boolean {
  const doc = view.state.doc;
  const a = doc.lineAt(from).number;
  const b = doc.lineAt(to).number;
  return view.state.selection.ranges.some((r) => {
    const ln = doc.lineAt(r.head).number;
    return ln >= a && ln <= b;
  });
}

function build(view: EditorView): DecorationSet {
  // Collect ranges then hand them to Decoration.set(..., true): Task 10 produces
  // OVERLAPPING decorations at the same offset (e.g. a StrongEmphasis style mark
  // spanning **bold** AND an EmphasisMark conceal sharing its start offset). A
  // RangeSetBuilder demands strictly ascending, non-overlapping starts and throws
  // on these; Decoration.set(ranges, true) sorts for us, so order doesn't matter.
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  // Iterate the FULL document range rather than view.visibleRanges: a detached
  // EditorView in jsdom (and any view before first layout/measure) reports empty
  // visibleRanges, which would yield zero decorations. For SP2 v1 this is fine;
  // it forgoes viewport virtualization (see concern in task report) but keeps the
  // cursor-reveal behavior correct everywhere.
  tree.iterate({
    from: 0,
    to: view.state.doc.length,
    enter(node) {
      // Node names verified via throwaway syntax-tree dump (deleted after use):
      //   HeaderMark      — ATX `#` marker (spans just "#", not "HeadingMark")
      //   StrongEmphasis  — `**bold**` span; Emphasis — `_it_` span
      //   Strikethrough   — `~~s~~` span; InlineCode — `` `c` `` span
      //   EmphasisMark    — `**`/`_` delimiters (shared by bold AND italic)
      //   StrikethroughMark — `~~` delimiters; CodeMark — `` ` `` delimiters
      switch (node.name) {
        case "HeaderMark": {
          const markTo = Math.min(node.to + 1, view.state.doc.length); // also eat the space
          if (!onCursorLine(view, node.from, markTo)) ranges.push(conceal.range(node.from, markTo));
          break;
        }
        case "StrongEmphasis":
          if (!onCursorLine(view, node.from, node.to)) ranges.push(styleBold.range(node.from, node.to));
          break;
        case "Emphasis":
          if (!onCursorLine(view, node.from, node.to)) ranges.push(styleItalic.range(node.from, node.to));
          break;
        case "Strikethrough":
          if (!onCursorLine(view, node.from, node.to)) ranges.push(styleStrike.range(node.from, node.to));
          break;
        case "InlineCode":
          if (!onCursorLine(view, node.from, node.to)) ranges.push(styleCode.range(node.from, node.to));
          break;
        case "EmphasisMark":
        case "CodeMark":
        case "StrikethroughMark":
          if (!onCursorLine(view, node.from, node.to)) ranges.push(conceal.range(node.from, node.to));
          break;
      }
    },
  });
  return Decoration.set(ranges, true);
}

/** Exposed for tests: how many decorations the plugin currently renders. */
export function decorationCount(view: EditorView): number {
  const plugin = view.plugin(_livePreview);
  if (!plugin) return 0;
  let n = 0;
  plugin.decorations.between(0, view.state.doc.length, () => {
    n++;
  });
  return n;
}

const _livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function livePreview() {
  return _livePreview;
}
