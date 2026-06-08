import { useEffect, useRef } from "preact/hooks";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { PanelDef, PanelContext } from "../contract";
import { previewPath } from "../bus";
import { Autosaver } from "../../core/autosave";
import { splitNote, compose } from "../../core/frontmatter";
import "./editor.css";

function Editor({ ctx }: { ctx: PanelContext }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saver = useRef<Autosaver | null>(null);
  const fm = useRef<{ raw: string | null; obj: Record<string, unknown>; edited: boolean }>({
    raw: null,
    obj: {},
    edited: false,
  });
  const path = previewPath.value;

  useEffect(() => {
    if (!path || !host.current) return;
    let cancelled = false;
    void ctx.daemon.file(path).then((f) => {
      if (cancelled || !host.current) return;
      const split = splitNote(f.content);
      fm.current = { raw: split.raw, obj: {}, edited: false };
      const sv = new Autosaver(ctx.daemon, {
        path,
        rev: f.rev,
        compose: () => compose(fm.current, view.current?.state.doc.toString() ?? ""),
      });
      saver.current = sv;
      view.current?.destroy();
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: split.body,
          extensions: [
            keymap.of(defaultKeymap),
            markdown(),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) sv.schedule();
            }),
          ],
        }),
      });
    });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
  }, [path]);

  if (!path) return <div class="ed-empty">Select a note from the Explorer.</div>;
  return <div class="ed" ref={host} />;
}

export const editorPanel: PanelDef = {
  type: "editor",
  name: "Editor",
  width: 640,
  placement: { t: 0.0, y: 0.24, r: 5.7, s: 0.005 },
  seed: false,
  Component: Editor,
};
