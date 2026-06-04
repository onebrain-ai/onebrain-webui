// Explorer panel — the vault file tree. Fetches `GET /api/vault/tree`, folds the
// flat list into a nested tree, and renders collapsible folders. Clicking a file
// opens it in Preview via `ctx.nav.openInPreview`.

import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { buildTree } from "../core/tree";
import type { TreeNode } from "../core/tree";
import { DaemonError } from "../core/types";
import { openFile } from "../core/stores";
import { registerPanel } from "./panel";
import type { PanelContext } from "./panel";
import { mountComponent } from "./mount";

function ExplorerView({ ctx }: { ctx: PanelContext }) {
  const [nodes, setNodes] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ctx.daemon
      .tree()
      .then((tree) => {
        if (live) setNodes(buildTree(tree.entries));
      })
      .catch((e: unknown) => {
        if (live) setError(describe(e));
      });
    return () => {
      live = false;
    };
  }, [ctx.daemon]);

  if (error) return <div class="ob-panel-error">⚠ {error}</div>;
  if (!nodes) return <div class="ob-panel-loading">Loading vault…</div>;
  if (nodes.length === 0) return <div class="ob-panel-empty">Empty vault</div>;

  return (
    <nav class="ob-tree" aria-label="Vault files">
      {nodes.map((n) => (
        <TreeRow key={n.path} node={n} depth={0} onOpen={ctx.nav.openInPreview} />
      ))}
    </nav>
  );
}

function TreeRow({
  node,
  depth,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (path: string) => void;
}) {
  // Folders start collapsed to keep the initial tree scannable.
  const open = useSignal(false);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (node.kind === "dir") {
    return (
      <div class="ob-tree-group">
        <button
          class="ob-tree-row ob-tree-dir"
          style={pad}
          aria-expanded={open.value}
          onClick={() => (open.value = !open.value)}
        >
          <span class="ob-tree-caret">{open.value ? "▾" : "▸"}</span>
          <span class="ob-tree-name">{node.name}</span>
        </button>
        {open.value &&
          node.children.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} onOpen={onOpen} />
          ))}
      </div>
    );
  }

  const active = openFile.value === node.path;
  return (
    <button
      class={`ob-tree-row ob-tree-file${active ? " is-active" : ""}`}
      style={pad}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span class="ob-tree-name">{node.name}</span>
    </button>
  );
}

function describe(e: unknown): string {
  if (e instanceof DaemonError) {
    return e.status === 0 ? e.message : `${e.message} (HTTP ${e.status})`;
  }
  return e instanceof Error ? e.message : String(e);
}

registerPanel({
  type: "explorer",
  name: "Explorer",
  icon: "EX",
  build: (container, ctx) => mountComponent(container, ctx, ExplorerView),
});
