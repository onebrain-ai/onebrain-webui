// Rich (non-text) file preview — render Office + drawio files to read-only HTML
// in the editor's reading pane.
//
// Each parser is its OWN lazy import() chunk, so a library is only fetched when a
// file of that type is actually opened — never on initial app load (mirrors the
// mermaid hybrid). The produced markup is DOMPurify-sanitised before it touches
// the DOM: vault files can arrive via /import or a fetched URL, so a crafted
// workbook/doc must not be able to smuggle a script/handler through.

import DOMPurify from "dompurify";
import type { DaemonClient } from "./daemon";
import "./richfile.css";

/** Extensions the editor previews via renderRichFile() instead of as text. */
const RICH_EXTENSIONS = new Set(["xlsx", "docx", "pptx", "drawio"]);

function ext(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}

/** True when `path` is a rich file the editor renders (not a text/code preview). */
export function isRichFile(path: string): boolean {
  return RICH_EXTENSIONS.has(ext(path));
}

/** A short human label for the type badge in the editor toolbar. */
export function richLabel(path: string): string {
  return { xlsx: "Spreadsheet", docx: "Document", pptx: "Slides", drawio: "Diagram" }[ext(path)] ?? "File";
}

/** Render a rich file into `host` (read-only). Rejects on a load/parse failure so
 *  the caller can surface an error instead of a blank pane. */
export async function renderRichFile(path: string, host: HTMLElement, daemon: DaemonClient): Promise<void> {
  switch (ext(path)) {
    case "xlsx":
      return renderXlsx(path, host, daemon);
    default:
      host.innerHTML = '<div class="rich-msg">Preview isn’t available for this file type yet.</div>';
  }
}

async function arrayBuffer(path: string, daemon: DaemonClient): Promise<ArrayBuffer> {
  return (await daemon.fileBlob(path)).arrayBuffer();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── xlsx (SheetJS) ──────────────────────────────────────────────────────────
async function renderXlsx(path: string, host: HTMLElement, daemon: DaemonClient): Promise<void> {
  const buf = await arrayBuffer(path, daemon);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const sheets = wb.SheetNames.map((name) => {
    // sheet_to_html emits a full <table> (SheetJS wraps it in a document; DOMPurify
    // strips the html/head/body shell and keeps the table + its inline styles).
    const table = XLSX.utils.sheet_to_html(wb.Sheets[name], { id: "", editable: false });
    return `<section class="rich-sheet"><div class="rich-sheet-name">${escapeHtml(name)}</div>${table}</section>`;
  });
  host.innerHTML = DOMPurify.sanitize(
    sheets.join("") || '<div class="rich-msg">This workbook has no sheets.</div>',
  );
}
