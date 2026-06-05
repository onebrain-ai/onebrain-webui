// Cross-panel vault store — the shared state panels read/write without knowing
// about each other. The Explorer loads the tree once; clicking a file sets
// `previewPath`, which the Preview panel(s) react to. Wikilinks resolve through
// the basename index built here. Panels import these signals directly; `ctx`
// carries only the daemon + imperative shell actions.

import { signal } from "@preact/signals";
import type { DaemonClient } from "../core/daemon";
import { buildTree, type TreeNode } from "../core/tree";

/** nested vault tree (null until loaded; stays null on load failure). */
export const vaultTree = signal<TreeNode[] | null>(null);
/** load error message, or null. Lets the Explorer distinguish "loading" from
 *  "failed" (both leave vaultTree null). */
export const vaultError = signal<string | null>(null);
/** the file the Preview panel(s) show. "" = nothing opened yet. */
export const previewPath = signal<string>("");

const _index = new Map<string, string>(); // lower(basename w/o ext) → path
let _files: string[] = [];

/** every file path in the vault (flat), for the Explorer's filter view. */
export function allFiles(): string[] {
  return _files;
}

/** Load the vault tree once at boot. Idempotent-ish: safe to call again to
 *  refresh. On failure leaves `vaultTree` null so the Explorer shows an error. */
export async function initVault(daemon: DaemonClient): Promise<void> {
  try {
    // hide dot-entries (.DS_Store, .git, .obsidian, …) so the tree reads as a
    // clean PARA workspace like the prototype — and so a non-text junk file
    // can't be opened into the Preview (the daemon 422s on those).
    const entries = (await daemon.tree()).entries.filter((e) => !e.path.split("/").some((seg) => seg.startsWith(".")));
    const tree = buildTree(entries);
    _files = [];
    _index.clear();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === "file") {
          _files.push(n.path);
          const base = n.name.replace(/\.[^.]+$/, "").toLowerCase();
          if (!_index.has(base)) _index.set(base, n.path); // first match wins
        } else {
          walk(n.children);
        }
      }
    };
    walk(tree);
    vaultError.value = null;
    vaultTree.value = tree;
    // open a sensible default so the cockpit isn't empty on first paint
    if (!previewPath.value && _files.length) {
      previewPath.value = _files.find((p) => p.toLowerCase().endsWith(".md")) ?? _files[0];
    }
  } catch (e) {
    console.error("[vault] tree load failed", e);
    vaultTree.value = null;
    vaultError.value = e instanceof Error ? e.message : "could not reach the daemon";
  }
}

/** Open a vault file in the Preview panel(s) (cross-panel action). */
export function openFile(path: string): void {
  previewPath.value = path;
}

/** Resolve a [[wikilink]] note name → vault path, or null if unknown. */
export function resolveWikilink(name: string): string | null {
  return _index.get(name.trim().toLowerCase()) ?? null;
}
