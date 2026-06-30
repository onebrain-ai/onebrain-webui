// File Browser panel — the Explorer tree + Preview combined into a single widget.
// The preview is the hero; the file tree is a collapsible left sidebar with a ☰
// toggle. Both panes read the shared bus (vaultTree / previewPath), so clicking a
// file in the tree updates the preview instantly — no extra wiring. A deliberate
// departure from the prototype, which keeps Explorer + Preview as separate panels.

import { useSignal } from "@preact/signals";
import type { PanelDef, PanelContext } from "../contract";
import { ExplorerTree } from "../explorer/explorer";
import { PreviewBody, previewExt } from "../preview/preview";
import "./files.css";

function Files({ ctx }: { ctx: PanelContext }) {
  const treeOpen = useSignal(true);
  return (
    <>
      <div class="w-head">
        <button
          class="fb-toggle"
          type="button"
          aria-label="Toggle file tree"
          aria-pressed={treeOpen.value ? "true" : "false"}
          onClick={() => (treeOpen.value = !treeOpen.value)}
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="pill">
          <span class="dot" />
          Vault · Browser
        </span>
        <span class="w-meta">{previewExt.value}</span>
      </div>
      <div class={`fb-body${treeOpen.value ? "" : " tree-hidden"}`}>
        <div class="fb-tree">
          <ExplorerTree ctx={ctx} />
        </div>
        <div class="fb-preview">
          <PreviewBody ctx={ctx} />
        </div>
      </div>
    </>
  );
}

export const filesPanel: PanelDef = {
  type: "files",
  name: "File Browser",
  width: 720,
  seed: true,
  Component: Files,
};
