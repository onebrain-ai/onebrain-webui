// Reading-view fenced code blocks: pretty-print structured langs, syntax-highlight
// via CodeMirror's language data (lazy, offline) + @lezer/highlight, and add a
// line-number gutter — so embedded code reads like the source-file view. Runs as a
// post-process after `renderMarkdown` emits each fence as
// `<pre><code class="language-…">…</code></pre>`; mermaid fences are skipped.

import DOMPurify from "dompurify";
import { highlightTree, classHighlighter } from "@lezer/highlight";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { formatCode } from "./codeformat";

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** Highlight `code` to HTML — `classHighlighter`'s stable `tok-*` classes wrapping
 *  ESCAPED text (so no markup from the source survives) — or null when no language
 *  matches / the grammar fails to load. Safe to assign via innerHTML: every code
 *  segment is escaped and the class names are library-controlled constants. */
async function highlightToHtml(code: string, lang: string): Promise<string | null> {
  if (!lang) return null;
  let parser;
  if (/^(hcl|tf|terraform|tfvars)$/.test(lang)) {
    // HCL / Terraform isn't in @codemirror/language-data — use the dedicated grammar.
    try {
      parser = (await import("codemirror-lang-hcl")).hclLanguage.parser;
    } catch {
      return null;
    }
  } else {
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    if (!desc) return null;
    try {
      parser = (await desc.load()).language.parser;
    } catch {
      return null;
    }
  }
  const tree = parser.parse(code);
  let html = "";
  let pos = 0;
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > pos) html += esc(code.slice(pos, from));
    html += `<span class="${classes}">${esc(code.slice(from, to))}</span>`;
    pos = to;
  });
  html += esc(code.slice(pos));
  return html;
}

/** Enhance every fenced code block under `root` in place: structured langs are
 *  pretty-printed, the body is syntax-highlighted, and a line-number gutter is
 *  added. Idempotent — already-enhanced blocks are skipped. */
export async function enhanceCodeBlocksIn(root: HTMLElement): Promise<void> {
  const codes = Array.from(root.querySelectorAll<HTMLElement>("pre > code")).filter(
    (c) => !c.closest("pre.mermaid"),
  );
  for (const code of codes) {
    const pre = code.parentElement as HTMLElement | null;
    if (!pre || pre.dataset.enhanced || pre.closest(".cm-codeblock")) continue;
    const lang = code.className.match(/language-([\w-]+)/)?.[1] ?? "";
    const raw = (code.textContent ?? "").replace(/\n$/, "");
    // Only JSON is reflowed — it's lossless (a commented/invalid json fails the
    // parse and is preserved). YAML/XML/others are shown exactly as written so
    // their comments and intentional layout survive; the serialisers drop them.
    const text = /^jsonc?$/.test(lang) ? await formatCode(lang, raw) : raw;
    const highlighted = await highlightToHtml(text, lang);
    const lineCount = Math.max(1, text.split("\n").length);

    const block = document.createElement("div");
    block.className = "cm-codeblock";
    block.dataset.enhanced = "1";
    if (lang) block.dataset.lang = lang;

    const gutter = document.createElement("div");
    gutter.className = "cm-code-gutter";
    gutter.setAttribute("aria-hidden", "true");
    gutter.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join("\n");

    const body = document.createElement("pre");
    body.className = "cm-code-body";
    const codeEl = document.createElement("code");
    // `highlighted` is already escaped text wrapped in library-controlled tok-*
    // spans; DOMPurify is belt-and-suspenders to match the vault-content sanitise
    // convention (same gate mermaid.ts uses for its rendered SVG).
    if (highlighted) codeEl.innerHTML = DOMPurify.sanitize(highlighted);
    else codeEl.textContent = text;
    body.appendChild(codeEl);

    block.appendChild(gutter);
    block.appendChild(body);
    pre.replaceWith(block);
  }
}
