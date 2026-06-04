// Build a nested tree from the daemon's FLAT, slash-separated entry list.
//
// The daemon returns `entries: [{path:"01-projects/onebrain/x.md", …}]` sorted
// by path (api.rs `walk_tree`). The Explorer wants a nested structure it can
// expand/collapse, so we fold the flat list into a tree here — pure + testable,
// no Preact, no fetch.

import type { VaultNode } from "./types";

export interface TreeNode {
  path: string; // vault-relative, slash-separated ("" for the synthetic root)
  name: string;
  kind: "file" | "dir";
  children: TreeNode[];
}

/** Fold a flat `VaultNode[]` into a sorted nested tree (dirs before files,
 *  each group alphabetical). The daemon already prunes tooling dirs; we keep
 *  every entry it sends. */
export function buildTree(entries: VaultNode[]): TreeNode[] {
  const root: TreeNode = { path: "", name: "", kind: "dir", children: [] };
  // Index by path so a child can find (or lazily create) its parent dir even if
  // the parent appears after the child — robust to any ordering.
  const byPath = new Map<string, TreeNode>([["", root]]);

  const ensureDir = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const name = slash === -1 ? path : path.slice(slash + 1);
    const parentPath = slash === -1 ? "" : path.slice(0, slash);
    const node: TreeNode = { path, name, kind: "dir", children: [] };
    byPath.set(path, node);
    ensureDir(parentPath).children.push(node);
    return node;
  };

  for (const entry of entries) {
    if (entry.kind === "dir") {
      ensureDir(entry.path);
      continue;
    }
    const slash = entry.path.lastIndexOf("/");
    const parentPath = slash === -1 ? "" : entry.path.slice(0, slash);
    ensureDir(parentPath).children.push({
      path: entry.path,
      name: entry.name,
      kind: "file",
      children: [],
    });
  }

  sortNode(root);
  return root.children;
}

/** Dirs first, then files; each group case-insensitively alphabetical. */
function sortNode(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const child of node.children) {
    if (child.kind === "dir") sortNode(child);
  }
}
