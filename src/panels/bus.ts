// Cross-panel vault store — the shared state panels read/write without knowing
// about each other. The Explorer loads the tree once; clicking a file sets
// `previewPath`, which the Preview panel(s) react to. Wikilinks resolve through
// the basename index built here. Panels import these signals directly; `ctx`
// carries only the daemon + imperative shell actions.

import { signal, computed } from "@preact/signals";
import type { DaemonClient } from "../core/daemon";
import { buildTree, type TreeNode } from "../core/tree";

/** nested vault tree (null until loaded; stays null on load failure). */
export const vaultTree = signal<TreeNode[] | null>(null);
/** load error message, or null. Lets the Explorer distinguish "loading" from
 *  "failed" (both leave vaultTree null). */
export const vaultError = signal<string | null>(null);
/** the file the Preview panel(s) show. "" = nothing opened yet. */
export const previewPath = signal<string>("");

/** Browser-style navigation history of opened notes (so back/forward work after
 *  clicking through wikilinks). `openFile` pushes; `navBack`/`navForward` move
 *  the cursor without pushing. */
export const navHistory = signal<string[]>([]);
export const navIndex = signal<number>(-1);
export const canNavBack = computed(() => navIndex.value > 0);
export const canNavForward = computed(() => navIndex.value < navHistory.value.length - 1);

const _byBase = new Map<string, string[]>(); // lower(basename w/o ext) → all paths
const _byPath = new Map<string, string>(); // lower(full rel path w/o ext) → path
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
    _byBase.clear();
    _byPath.clear();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === "file") {
          _files.push(n.path);
          _byPath.set(n.path.replace(/\.[^./]+$/, "").toLowerCase(), n.path);
          const base = (n.name.includes(".") ? n.name.replace(/\.[^.]+$/, "") : n.name).toLowerCase();
          const arr = _byBase.get(base);
          if (arr) arr.push(n.path);
          else _byBase.set(base, [n.path]);
        } else {
          walk(n.children);
        }
      }
    };
    walk(tree);
    // For a bare [[Name]] with duplicates, prefer the shortest path (fewest
    // folders, then shorter string) — Obsidian's "shortest-path" default.
    for (const arr of _byBase.values()) {
      arr.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
    }
    vaultError.value = null;
    vaultTree.value = tree;
    // open a sensible default so the cockpit isn't empty on first paint (via
    // openFile so it seeds the nav history at index 0)
    if (!previewPath.value && _files.length) {
      openFile(_files.find((p) => p.toLowerCase().endsWith(".md")) ?? _files[0]);
    }
  } catch (e) {
    console.error("[vault] tree load failed", e);
    vaultTree.value = null;
    vaultError.value = e instanceof Error ? e.message : "could not reach the daemon";
  }
}

/** Open a vault file (cross-panel action) and push it onto the nav history so
 *  back/forward can return to it. Re-opening the current file is a no-op. */
export function openFile(path: string): void {
  if (!path || path === previewPath.value) return;
  // Drop any forward history, then push.
  const h = navHistory.value.slice(0, navIndex.value + 1);
  h.push(path);
  navHistory.value = h;
  navIndex.value = h.length - 1;
  previewPath.value = path;
}

/** Go back to the previously-opened note (no-op at the start of history). */
export function navBack(): void {
  if (navIndex.value <= 0) return;
  navIndex.value -= 1;
  previewPath.value = navHistory.value[navIndex.value];
}

/** Go forward to the next note in history (no-op at the end). */
export function navForward(): void {
  if (navIndex.value >= navHistory.value.length - 1) return;
  navIndex.value += 1;
  previewPath.value = navHistory.value[navIndex.value];
}

/** Resolve a `[[wikilink]]` target → a vault path, or null if unknown.
 *
 * - `[[folder/Note]]` (path-qualified) resolves by matching the path suffix, so
 *   you can disambiguate two same-named notes by including enough of the folder.
 * - `[[Note]]` (bare) matches by basename; when several notes share the name it
 *   picks the SHORTEST path (Obsidian's default). To target a specific one, write
 *   the folder: `[[01-projects/memmoth/Note]]`.
 * - `#heading` / `|alias` suffixes are ignored for resolution. */
export function resolveWikilink(name: string): string | null {
  const norm = name
    .trim()
    .split("#")[0]
    .split("|")[0]
    .trim()
    .replace(/\.md$/i, "")
    .replace(/^\.?\//, "")
    .toLowerCase();
  if (!norm) return null;
  if (norm.includes("/")) {
    const exact = _byPath.get(norm);
    if (exact) return exact;
    let best: string | null = null;
    for (const [key, path] of _byPath) {
      if (key === norm || key.endsWith("/" + norm)) {
        if (!best || path.length < best.length) best = path;
      }
    }
    return best;
  }
  const arr = _byBase.get(norm);
  return arr && arr.length ? arr[0] : null;
}
