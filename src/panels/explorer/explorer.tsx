// File Explorer panel — the PARA vault tree, wired to the live daemon. Ported
// from the prototype (template 1242–1246, buildExplorer 2782–2837). Collapsible
// dirs + a flat filter view; clicking a file opens it in Preview (cross-panel).

import { useSignal } from "@preact/signals";
import type { PanelDef, PanelContext } from "../contract";
import type { TreeNode } from "../../core/tree";
import { vaultTree, vaultError, previewPath, allFiles } from "../bus";
import "./explorer.css";

type FileType = "dir" | "img" | "html" | "yml" | "md";

function fileType(node: TreeNode): FileType {
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

function Explorer({ ctx }: { ctx: PanelContext }) {
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
      const name = path.split("/").pop() ?? path;
      const dir = path.split("/").slice(0, -1).join("/") || "root";
      const type = fileType({ kind: "file", name, path, children: [] });
      rows.push(
        <div
          class={`fx-row${path === active ? " active" : ""}`}
          style="padding-left:7px"
          onClick={() => ctx.openFile(path)}
        >
          <span class="fx-tw" />
          <FileIcon type={type} />
          <span class="fx-nm">{name}</span>
          <span class="fx-ext">{dir}</span>
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
            <div class={`fx-row dir${isOpen ? " open" : ""}`} style={pad} onClick={() => toggle(node.path)}>
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
              onClick={() => ctx.openFile(node.path)}
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
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Vault · Explorer
        </span>
        <span class="w-meta">PARA</span>
      </div>
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

export const explorerPanel: PanelDef = {
  type: "explorer",
  name: "File Explorer",
  width: 286,
  placement: { t: -0.64, y: 0.26, r: 6.9, s: 0.005 },
  seed: true,
  Component: Explorer,
};
