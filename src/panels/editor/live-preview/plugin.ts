import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";

/** Replace a range with nothing (conceal). */
const conceal = Decoration.replace({});

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
  const b = new RangeSetBuilder<Decoration>();
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
      // Verified node name via syntax-tree dump for "# Title\n\nbody":
      // the ATX `#` marker node is "HeaderMark" (spanning just "#"), not "HeadingMark".
      if (node.name === "HeaderMark") {
        const markTo = Math.min(node.to + 1, view.state.doc.length); // also eat the space
        if (!onCursorLine(view, node.from, markTo)) b.add(node.from, markTo, conceal);
      }
    },
  });
  return b.finish();
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
