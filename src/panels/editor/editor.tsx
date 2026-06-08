import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { PanelDef, PanelContext } from "../contract";
import { previewPath } from "../bus";
import { Autosaver } from "../../core/autosave";
import { splitNote, parseFrontmatter, compose } from "../../core/frontmatter";
import { Properties } from "./properties";
import { livePreview } from "./live-preview/plugin";
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
  const props = useSignal<Record<string, unknown>>({});
  const path = previewPath.value;

  useEffect(() => {
    if (!path || !host.current) return;
    let cancelled = false;
    void ctx.daemon.file(path).then((f) => {
      if (cancelled || !host.current) return;
      const split = splitNote(f.content);
      const obj = parseFrontmatter(split.raw);
      fm.current = { raw: split.raw, obj, edited: false };
      props.value = obj;
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
            livePreview(),
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

  const onProps = (next: Record<string, unknown>) => {
    props.value = next;
    fm.current = { ...fm.current, obj: next, edited: true };
    saver.current?.schedule();
  };

  return (
    <div class="ed-wrap">
      <Properties value={props.value} onChange={onProps} />
      <div class="ed" ref={host} />
    </div>
  );
}

export const editorPanel: PanelDef = {
  type: "editor",
  name: "Editor",
  width: 640,
  placement: { t: 0.0, y: 0.24, r: 5.7, s: 0.005 },
  seed: false,
  Component: Editor,
};
