// File Explorer panel — the PARA vault tree, wired to the live daemon. Ported
// from the prototype (template 1242–1246, buildExplorer 2782–2837). Collapsible
// dirs + a flat filter view; clicking a file opens it in Preview (cross-panel).

import { useSignal } from "@preact/signals";
import type { PanelDef, PanelContext } from "../contract";
import type { TreeNode } from "../../core/tree";
import { vaultTree, vaultError, previewPath, allFiles } from "../bus";
import "./explorer.css";

type FileType = "dir" | "img" | "html" | "yml" | "md";

export function fileType(node: TreeNode): FileType {
  if (node.kind === "dir") return "dir";
  const ext = node.name.includes(".") ? node.name.split(".").pop()!.toLowerCase() : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext)) return "img";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "yml" || ext === "yaml") return "yml";
  return "md";
}

function FileIcon({ type }: { type: FileType }) {
  const paths: Record<FileType, preact.JSX.Element> = {
    dir: <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
    img: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <circle cx="8.5" cy="8.5" r="1.6" />
        <path d="M21 16l-5-5L4 20" />
      </>
    ),
    html: (
      <>
        <path d="M5 3h14v18H5z" />
        <path d="M9.5 9l-2 3 2 3M14.5 9l2 3-2 3" />
      </>
    ),
    yml: (
      <>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M9 13h6M9 16h4" />
      </>
    ),
    md: (
      <>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M14 2v6h6M9 13h6M9 16h4" />
      </>
    ),
  };
  return (
    <svg class="fx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      {paths[type]}
    </svg>
  );
}

/** Split `s` into [before, match, after] on the first case-insensitive hit of
 *  `q`, or null when `q` isn't in `s` (e.g. the filter matched the folder path,
 *  not this filename). Lets the filter view highlight exactly what matched. */
export function splitMatch(s: string, q: string): [string, string, string] | null {
  if (!q) return null;
  const i = s.toLowerCase().indexOf(q);
  if (i < 0) return null;
  return [s.slice(0, i), s.slice(i, i + q.length), s.slice(i + q.length)];
}

/** Collapse a parent path to its last two segments with a leading ellipsis, so
 *  the nearest folder (the disambiguating part when names share a long prefix)
 *  always stays visible. An empty `parent` (the only value a real folder name can
 *  never take) flags a vault-root file — so a folder literally named "root" is
 *  not mistaken for the root sentinel. */
export function tailPath(parent: string): { text: string; clipped: boolean; root: boolean } {
  if (parent === "") return { text: "", clipped: false, root: true };
  const segs = parent.split("/");
  return { text: segs.slice(-2).join("/"), clipped: segs.length > 2, root: false };
}

/** Activate a role="button" row on Enter/Space (rows are divs, so they need an
 *  explicit keyboard path to be operable without a mouse). */
function rowKey(e: KeyboardEvent, action: () => void): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

/** Render a string with its matched run wrapped in <mark>, or plain when no match. */
function hilite(parts: [string, string, string] | null, fallback: string) {
  if (!parts) return fallback;
  return (
    <>
      {parts[0]}
      <mark class="fx-mk">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

/** The PARA tree + filter — the reusable body (no panel header), shared by the
 *  standalone Explorer panel and the combined File Browser. */
export function ExplorerTree({ ctx }: { ctx: PanelContext }) {
  const filter = useSignal("");
  // open-dir set; the prototype defaults a few PARA folders open.
  const open = useSignal<Set<string>>(new Set(["00-inbox", "01-projects", "01-projects/onebrain"]));

  const tree = vaultTree.value;
  const active = previewPath.value;
  const q = filter.value.trim().toLowerCase();

  const toggle = (path: string) => {
    const next = new Set(open.value);
    next.has(path) ? next.delete(path) : next.add(path);
    open.value = next;
  };

  const rows: preact.JSX.Element[] = [];
  let fileCount = 0;

  if (q) {
    // flat filtered view
    const hits = allFiles().filter((p) => p.toLowerCase().includes(q));
    fileCount = hits.length;
    for (const path of hits) {
      const name = path.split("/").pop()!;
      const dir = path.split("/").slice(0, -1).join("/"); // "" for a vault-root file
      const type = fileType({ kind: "file", name, path, children: [] });
      const nm = splitMatch(name, q);
      const tp = tailPath(dir);
      // highlight inside the path tail only when the name itself didn't match —
      // so a folder-only hit still shows *why* it surfaced.
      const dirParts = !nm && !tp.root ? splitMatch(tp.text, q) : null;
      rows.push(
        <div
          class={`fx-hit${path === active ? " active" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => ctx.openFile(path)}
          onKeyDown={(e) => rowKey(e, () => ctx.openFile(path))}
          title={path}
        >
          <FileIcon type={type} />
          <span class="fx-hit-body">
            <span class="fx-hit-nm">{hilite(nm, name)}</span>
            {tp.root ? (
              <span class="fx-hit-dir is-root">vault root</span>
            ) : (
              <span class="fx-hit-dir">
                {tp.clipped ? "…/" : ""}
                {hilite(dirParts, tp.text)}
              </span>
            )}
          </span>
        </div>,
      );
    }
  } else if (tree) {
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        const pad = `padding-left:${7 + depth * 13}px`;
        if (node.kind === "dir") {
          const isOpen = open.value.has(node.path);
          rows.push(
            <div
              class={`fx-row dir${isOpen ? " open" : ""}`}
              style={pad}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(node.path)}
              onKeyDown={(e) => rowKey(e, () => toggle(node.path))}
            >
              <svg class="fx-tw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                <path d="M9 6l6 6-6 6" />
              </svg>
              <FileIcon type="dir" />
              <span class="fx-nm">{node.name}</span>
            </div>,
          );
          if (isOpen) walk(node.children, depth + 1);
        } else {
          fileCount++;
          const ext = node.name.includes(".") ? node.name.split(".").pop()! : "";
          rows.push(
            <div
              class={`fx-row${node.path === active ? " active" : ""}`}
              style={pad}
              role="button"
              tabIndex={0}
              onClick={() => ctx.openFile(node.path)}
              onKeyDown={(e) => rowKey(e, () => ctx.openFile(node.path))}
            >
              <span class="fx-tw" />
              <FileIcon type={fileType(node)} />
              <span class="fx-nm">{node.name}</span>
              {ext && <span class="fx-ext">{ext}</span>}
            </div>,
          );
        }
      }
    };
    walk(tree, 0);
  }

  return (
    <>
      <div class="fx-tools">
        <input
          class="fx-filter"
          type="text"
          placeholder="filter files…"
          autocomplete="off"
          spellcheck={false}
          value={filter.value}
          onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)}
        />
        {filter.value && (
          <button
            class="fx-clear"
            type="button"
            title="Clear"
            aria-label="Clear filter"
            onClick={(e) => {
              filter.value = "";
              (e.currentTarget.closest(".fx-tools")?.querySelector("input") as HTMLInputElement | null)?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        <span class="fx-count">
          {tree ? (q ? `${fileCount} match` : `${fileCount} files`) : vaultError.value ? "load failed" : "loading…"}
        </span>
      </div>
      <div class="fx-tree">
        {tree ? rows : <div class="fx-note">{vaultError.value ? `⚠ ${vaultError.value}` : "loading vault…"}</div>}
      </div>
    </>
  );
}

function Explorer({ ctx }: { ctx: PanelContext }) {
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Vault · Explorer
        </span>
        <span class="w-meta">PARA</span>
      </div>
      <ExplorerTree ctx={ctx} />
    </>
  );
}

export const explorerPanel: PanelDef = {
  type: "explorer",
  name: "File Explorer",
  width: 286,
  seed: false, // folded into the combined File Browser; still spawnable standalone
  Component: Explorer,
};
