// Preview panel — reads the `openFile` signal, fetches the note via
// `GET /api/vault/file?path=`, and renders it (frontmatter + markdown reading
// view). Clicking a [[wikilink]] resolves it against the vault index and opens
// the target in place.
//
// Editing (CodeMirror 6 live preview) + the `PUT` write path are the next PKM
// step (needs daemon step 2b); this panel is the read seam they slot into.

import { useEffect, useRef, useState } from "preact/hooks";
import { openFile, resolveWikilink } from "../core/stores";
import { renderMarkdown } from "../core/markdown";
import type { ParsedNote } from "../core/markdown";
import { DaemonError } from "../core/types";
import type { VaultFile } from "../core/types";
import { registerPanel } from "./panel";
import type { PanelContext } from "./panel";
import { mountComponent } from "./mount";

function PreviewView({ ctx }: { ctx: PanelContext }) {
  const path = openFile.value;
  const [file, setFile] = useState<VaultFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setFile(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    ctx.daemon
      .file(path)
      .then((f) => live && setFile(f))
      .catch((e: unknown) => {
        if (live) {
          setFile(null);
          setError(describe(e));
        }
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, ctx.daemon]);

  if (!path) {
    return (
      <div class="ob-preview-empty">
        <p>Select a note from the Explorer to read it.</p>
      </div>
    );
  }

  return (
    <article class="ob-preview">
      <header class="ob-preview-head">
        <span class="ob-preview-path">{path}</span>
        {file && <span class="ob-preview-rev" title="revision (mtime ns)">rev {file.rev}</span>}
      </header>
      {loading && <div class="ob-panel-loading">Loading…</div>}
      {error && <div class="ob-panel-error">⚠ {error}</div>}
      {file && !loading && !error && <NoteBody content={file.content} />}
    </article>
  );
}

/** Render parsed markdown + frontmatter, and delegate [[wikilink]] clicks to
 *  open the resolved note (a missing target is a no-op, visually inert). */
function NoteBody({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const parsed: ParsedNote = renderMarkdown(content);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (ev: Event) => {
      const target = ev.target as HTMLElement;
      const link = target.closest<HTMLElement>(".ob-wikilink");
      if (!link) return;
      ev.preventDefault();
      // `data-wikilink` is always set by the renderer (markdown.ts), and carries
      // the link TARGET (not the alias) — so aliased [[Target|Alias]] resolves
      // on Target, not the visible text.
      const resolved = resolveWikilink(link.dataset.wikilink ?? "");
      if (resolved) openFile.value = resolved;
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [content]);

  return (
    <>
      {parsed.frontmatter && <pre class="ob-frontmatter">{parsed.frontmatter}</pre>}
      {/* eslint-disable-next-line react/no-danger -- HTML is built by our own
          escape-first renderer (core/markdown.ts); no source markup passes through. */}
      <div class="ob-md" ref={ref} dangerouslySetInnerHTML={{ __html: parsed.html }} />
    </>
  );
}

function describe(e: unknown): string {
  if (e instanceof DaemonError) {
    return e.status === 0 ? e.message : `${e.message} (HTTP ${e.status})`;
  }
  return e instanceof Error ? e.message : String(e);
}

registerPanel({
  type: "preview",
  name: "Preview",
  icon: "PV",
  build: (container, ctx) => mountComponent(container, ctx, PreviewView),
});
