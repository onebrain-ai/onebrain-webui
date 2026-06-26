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
    case "docx":
      return renderDocx(path, host, daemon);
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
  const names = wb.SheetNames;
  if (names.length === 0) {
    host.innerHTML = '<div class="rich-msg">This workbook has no sheets.</div>';
    return;
  }
  // sheet_to_html emits a full <table> (SheetJS wraps it in a document; DOMPurify
  // strips the html/head/body shell and keeps the table + its inline styles).
  const tab = (n: string, i: number) =>
    `<button class="rich-tab${i === 0 ? " is-active" : ""}" data-sheet="${i}" type="button">${escapeHtml(n)}</button>`;
  const panel = (n: string, i: number) =>
    `<div class="rich-tab-panel${i === 0 ? "" : " rich-hidden"}" data-sheet="${i}">${XLSX.utils.sheet_to_html(wb.Sheets[n], { id: "", editable: false })}</div>`;
  // One tab per sheet (mirrors Excel's sheet tabs). A single-sheet book skips the bar.
  const bar = names.length > 1 ? `<div class="rich-tabs" role="tablist">${names.map(tab).join("")}</div>` : "";
  host.innerHTML = DOMPurify.sanitize(`${bar}<div class="rich-tab-body">${names.map(panel).join("")}</div>`);

  // Wire tab switching by hand — richfile renders into a plain host, not a Preact
  // tree, so there's no JSX onClick. Toggling classes keeps every sheet in the DOM
  // (instant switch, no re-parse).
  const tabs = [...host.querySelectorAll<HTMLButtonElement>(".rich-tab")];
  const panels = [...host.querySelectorAll<HTMLElement>(".rich-tab-panel")];
  for (const btn of tabs) {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.sheet;
      for (const b of tabs) b.classList.toggle("is-active", b === btn);
      for (const p of panels) p.classList.toggle("rich-hidden", p.dataset.sheet !== idx);
    });
  }
}

// ── docx (mammoth) ──────────────────────────────────────────────────────────
async function renderDocx(path: string, host: HTMLElement, daemon: DaemonClient): Promise<void> {
  const buf = await arrayBuffer(path, daemon);
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
  host.innerHTML =
    '<article class="rich-doc">' +
    DOMPurify.sanitize(value || '<p class="rich-msg">This document is empty.</p>') +
    "</article>";
}
