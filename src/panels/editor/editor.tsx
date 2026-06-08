import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { PanelDef, PanelContext } from "../contract";
import { previewPath } from "../bus";
import { Autosaver, saveStatus, dirty, conflictRev } from "../../core/autosave";
import { editorBridge } from "../../core/editor-bridge";
import { splitNote, parseFrontmatter, compose } from "../../core/frontmatter";
import { Properties } from "./properties";
import { livePreview } from "./live-preview/plugin";
import { renderMarkdown } from "../../core/markdown";
import "./editor.css";

/**
 * The run-function wired to the Mod-s keybinding.
 * Exported so tests can invoke it directly (jsdom does not propagate key events
 * through CodeMirror's event handler chain, so fireEvent.keyDown cannot reach it).
 * In production this is called by CodeMirror; the `sv` closure is set per-load.
 */
export let _cmdSaveRun: (() => boolean) | null = null;

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
  const reading = useSignal(false);
  const path = previewPath.value;

  useEffect(() => {
    if (!path || !host.current) return;
    // Each note starts clean — clear any prior note's save/conflict state so a
    // stale toast/indicator can't carry over to a different note.
    saveStatus.value = "idle";
    dirty.value = false;
    conflictRev.value = null;
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
      const cmdSaveRun = () => { void sv.flush(); return true; };
      _cmdSaveRun = cmdSaveRun;
      view.current?.destroy();
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: split.body,
          extensions: [
            keymap.of([
              { key: "Mod-s", run: cmdSaveRun },
              ...defaultKeymap,
            ]),
            markdown({ base: markdownLanguage }),
            livePreview(),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) sv.schedule();
            }),
          ],
        }),
      });
      const reload = async () => {
        const f2 = await ctx.daemon.file(path);
        if (cancelled || previewPath.value !== path) return; // note switched mid-reload — abandon
        const myView = view.current;
        if (!myView) return;
        const s2 = splitNote(f2.content);
        fm.current = { raw: s2.raw, obj: parseFrontmatter(s2.raw), edited: false };
        props.value = fm.current.obj;
        sv.adoptRev(f2.rev);
        myView.dispatch({ changes: { from: 0, to: myView.state.doc.length, insert: s2.body } });
        conflictRev.value = null;
        dirty.value = false;
        saveStatus.value = "saved";
      };
      editorBridge.value = { overwrite: () => sv.overwrite(), reload };
    });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
      editorBridge.value = null;
      _cmdSaveRun = null;
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
      <div class="ed-toolbar">
        <button
          class="ed-toggle"
          data-testid="ed-reading-toggle"
          onClick={() => { reading.value = !reading.value; }}
        >
          {reading.value ? "Edit" : "Read"}
        </button>
      </div>
      <Properties value={props.value} onChange={onProps} />
      {reading.value && (
        <div
          class="ed-reading"
          data-testid="ed-reading"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(view.current?.state.doc.toString() ?? "").html }}
        />
      )}
      <div class={reading.value ? "ed ed-hidden" : "ed"} ref={host} />
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
