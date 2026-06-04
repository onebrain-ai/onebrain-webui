// Preview panel — reads the `openFile` signal, fetches the note via
// `GET /api/vault/file?path=`, and shows its content read-only.
//
// v1 renders the raw markdown source in a readable reading pane (no rich
// markdown render / editing yet). The Obsidian-replacement editor — live
// preview + wikilink autocomplete + backlinks on CodeMirror 6 — is the next
// PKM step (spec §7, open item #5); this panel is the seam it slots into.

import { useEffect, useState } from "preact/hooks";
import { openFile } from "../core/stores";
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
      .then((f) => {
        if (live) setFile(f);
      })
      .catch((e: unknown) => {
        if (live) {
          setFile(null);
          setError(describe(e));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
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
      {file && !loading && !error && <pre class="ob-preview-body">{file.content}</pre>}
    </article>
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
