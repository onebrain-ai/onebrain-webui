// A compact, dependency-free markdown → HTML renderer for the reading view.
//
// Scope is deliberate: the common Obsidian note vocabulary (frontmatter,
// headings, bold/italic, inline + fenced code, links, [[wikilinks]], lists,
// blockquotes, hr, tables). It is NOT a full CommonMark engine — the live editor
// (CodeMirror 6) is the later step; this gives a faithful, lean read view.
//
// SECURITY: vault content is rendered as HTML, so every text run is
// HTML-escaped BEFORE any markdown markup is added. Markup is only ever
// introduced by this renderer, never carried through from the source — so a note
// containing `<script>` renders as literal text, not an injected element.

import DOMPurify from "dompurify";

export interface ParsedNote {
  /** Raw YAML frontmatter block (without the `---` fences), or null. */
  frontmatter: string | null;
  /** Rendered HTML for the body (frontmatter stripped). */
  html: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Strip renderer-injected emphasis tags out of a value about to be placed inside
 *  an attribute (href / data-wikilink), so the markup never corrupts the attr or
 *  the navigation target the Preview reads back. */
const attrSafe = (s: string): string => s.replace(/<\/?[a-z][^>]*>/gi, "");

/** A markdown table separator row: only space/pipe/colon/dash, and it MUST
 *  contain both a pipe and a dash. The pipe requirement stops a bare `----`
 *  horizontal rule under a `Foo | Bar` line from being misread as a table. */
function isTableSeparator(line: string): boolean {
  return /\|/.test(line) && /-/.test(line) && /^[\s|:-]+$/.test(line);
}

/** Split a leading `--- … ---` YAML frontmatter block off the top of a note. */
function splitFrontmatter(src: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (m) return { frontmatter: m[1], body: src.slice(m[0].length) };
  return { frontmatter: null, body: src };
}

/** Inline formatting on an already-block-split line. Escapes first, then layers
 *  markup whose delimiters can't appear in escaped text except as literals. */
function inline(text: string): string {
  // Verbatim-span sentinels (STX / ETX) — never appear in note text and carry no
  // markdown metacharacter, so the emphasis/link/tag passes skip over them. Built
  // at runtime (String.fromCharCode) so the source stays plain text.
  const C = String.fromCharCode(2); // inline code
  const M = String.fromCharCode(3); // inline math
  let s = esc(text);
  // Pull inline code + inline math out first so nothing formats their interior.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `${C}${codes.length - 1}${C}`;
  });
  // $…$ inline math: content can't start/end with whitespace, so "$5 and $10"
  // isn't read as math. Block $$…$$ is handled at the block level.
  const maths: string[] = [];
  s = s.replace(/\$(\S|\S[^$\n]*?\S)\$/g, (_m, tex) => {
    maths.push(tex);
    return `${M}${maths.length - 1}${M}`;
  });
  // Emphasis.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // The italic opener must NOT be preceded by a word char and its content must
  // not start with whitespace — so `2*3*4` / `a*b*c` (math, intra-word) don't
  // become italics, while `a *word* b` and `*lead*` do (R2).
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  // Footnote references [^id] → superscript link (run while code/math are still
  // sentinels so a [^x] inside `code` is left alone).
  s = s.replace(
    /\[\^([\w-]+)\]/g,
    (_m, id) => `<sup class="fn-ref" id="fnref-${esc(id)}"><a href="#fn-${esc(id)}">${esc(id)}</a></sup>`,
  );
  // #tags → clickable. Run BEFORE restoring code/math so a "#x" inside a code span
  // isn't tagged. Must follow start-or-whitespace and start with a letter/_ (so
  // "#1" and a URL fragment, preceded by a non-space, aren't tags).
  s = s.replace(
    /(^|\s)#([A-Za-z_][\w/-]*)/g,
    (_m, pre, tag) => `${pre}<span class="ob-tag" data-tag="${esc(tag)}">#${esc(tag)}</span>`,
  );
  // Restore verbatim code + math BEFORE the link passes, so a `code`/$math$ inside
  // a link label renders while attrSafe still strips those tags from the attribute.
  s = s.replace(new RegExp(C + "(\\d+)" + C, "g"), (_m, i) => `<code>${codes[Number(i)]}</code>`);
  s = s.replace(
    new RegExp(M + "(\\d+)" + M, "g"),
    (_m, i) => `<span class="math-inline" data-math>${maths[Number(i)]}</span>`,
  );
  // Image embeds ![[image.png]] (images only) — emit a placeholder the reading
  // view resolves (basename → vault path → authed raw URL). Before the wikilink
  // pass so the inner [[…]] isn't consumed as a link.
  s = s.replace(/!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp))\]\]/gi, (_m, target) => {
    const t = attrSafe(target.trim());
    return `<img data-vault-embed="${t}" alt="${t}" loading="lazy">`;
  });
  // Markdown images ![alt](src). External http(s)/data render directly; a
  // vault-relative src becomes data-vault-src for the reading view to resolve+auth.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    const clean = attrSafe(src);
    const a = attrSafe(alt);
    if (/^(https?:|data:image\/)/i.test(clean)) {
      return `<img src="${clean}" alt="${a}" loading="lazy">`;
    }
    return `<img data-vault-src="${clean.replace(/^\.?\//, "")}" alt="${a}" loading="lazy">`;
  });
  // Links [text](url). attrSafe strips any markup the passes above left in href.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, href) => {
    const clean = attrSafe(href);
    const safe = /^https?:|^mailto:|^\//.test(clean) ? clean : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  // [[wikilink]], [[link|alias]], [[note#heading]] → a span the Preview wires for
  // navigation: data-wikilink = clean note path, data-heading = optional anchor.
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
    const tgt = target.trim();
    const hash = tgt.indexOf("#");
    const note = hash >= 0 ? tgt.slice(0, hash) : tgt;
    const head = hash >= 0 ? tgt.slice(hash + 1).trim() : "";
    const label = alias ?? tgt;
    const dataHead = head ? ` data-heading="${attrSafe(headingSlug(head))}"` : "";
    return `<span class="ob-wikilink" data-wikilink="${attrSafe(note)}"${dataHead}>${label}</span>`;
  });
  return s;
}

/** Slugify a heading for an `id`/anchor (lowercased, spaces → "-", punctuation
 *  dropped) — must match the slug put on rendered headings so anchors line up. */
function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Obsidian callout type → icon key (covers the common aliases). Unknown → info.
const CALLOUT_ICON_KEY: Record<string, string> = {
  note: "pencil", abstract: "clipboard", summary: "clipboard", tldr: "clipboard",
  info: "info", todo: "check-circle", tip: "flame", hint: "flame", important: "flame",
  success: "check", check: "check", done: "check", question: "help", help: "help",
  faq: "help", warning: "warning", caution: "warning", attention: "warning",
  failure: "x", fail: "x", missing: "x", danger: "zap", error: "zap", bug: "bug",
  example: "list", quote: "quote", cite: "quote",
};
const ICON_SVG: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  pencil: '<path d="M4 20h4L18.5 9.5l-4-4L4 16z"/><path d="M13.5 6l4 4"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  flame: '<path d="M12 3c1 3-2 4-2 7a3 3 0 0 0 6 0c0-1.5-1-2.5-1-2.5 2 1 3 3 3 5a6 6 0 1 1-12 0c0-4 4-5 6-9.5z"/>',
  check: '<path d="M5 12l4 4L19 7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  bug: '<rect x="6" y="8" width="12" height="11" rx="5"/><path d="M12 8V5M8 4l2 2M16 4l-2 2M6 12H3M21 12h-3M6 16H3M21 16h-3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  quote: '<path d="M7 7h4v6c0 2-1.5 3.5-3.5 4M14 7h4v6c0 2-1.5 3.5-3.5 4"/>',
};
function calloutIconHtml(type: string): string {
  const inner = ICON_SVG[CALLOUT_ICON_KEY[type] ?? "info"] ?? ICON_SVG.info;
  return `<svg class="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** Render the note body (frontmatter already removed) to HTML. `lineBase` is the
 *  absolute 0-based body-line index of `src`'s first line — 0 at the top level,
 *  but a callout's recursive render passes the callout body's real offset so a
 *  task checkbox's `data-line` stays aligned with the source/CodeMirror doc. */
function renderBody(src: string, lineBase = 0): string {
  // Pull footnote definitions ([^id]: text) out up front — they render as a list
  // at the bottom of the note, not inline. Blank the line (rather than removing
  // it) so every other line keeps its index → the reading view's task checkboxes
  // can carry a `data-line` that maps back to the source line for write-back.
  const footnotes: { id: string; text: string }[] = [];
  const lines = src.split("\n");
  let inFence = false;
  for (let j = 0; j < lines.length; j++) {
    if (/^```/.test(lines[j])) {
      inFence = !inFence; // don't treat a `[^x]:` line inside a code fence as a footnote
      continue;
    }
    if (inFence) continue;
    const m = /^\[\^([\w-]+)\]:\s?(.*)$/.exec(lines[j]);
    if (m) {
      footnotes.push({ id: m[1], text: m[2] });
      lines[j] = ""; // skipped by the blank-line handler; index preserved
    }
  }
  const out: string[] = [];
  let i = 0;

  // Heading ids must be unique — append -2, -3, … on a repeated slug so duplicate
  // headings don't emit duplicate ids (invalid HTML; anchors would all hit the first).
  const usedSlugs = new Set<string>();
  const uniqueSlug = (base: string): string => {
    let slug = base || "section";
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${base || "section"}-${n}`;
    usedSlugs.add(slug);
    return slug;
  };

  const flushTable = (rows: string[]): void => {
    // A pipe table: header | --- separator | body rows. The separator row is
    // dropped; cells get inline formatting.
    const cells = (row: string) =>
      row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const header = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    out.push("<table><thead><tr>");
    for (const h of header) out.push(`<th>${inline(h)}</th>`);
    out.push("</tr></thead><tbody>");
    for (const r of body) {
      out.push("<tr>");
      for (const c of r) out.push(`<td>${inline(c)}</td>`);
      out.push("</tr>");
    }
    out.push("</tbody></table>");
  };

  // Render a contiguous run of list lines (incl. indented children) into nested
  // <ul>/<ol>. An indent stack keeps each child list INSIDE its parent <li>.
  const renderList = (listLines: string[], startLine: number): string => {
    const items = listLines.map((ln, idx) => {
      const m = /^([ \t]*)([-*+]|\d+\.)\s+(.*)$/.exec(ln)!;
      const indent = m[1].replace(/\t/g, "  ").length;
      const ordered = /\d/.test(m[2]);
      const taskM = ordered ? null : /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
      // line = 0-based body line index (footnote lines were blanked, not removed,
      // so this stays aligned with the CodeMirror doc for checkbox write-back).
      return {
        indent,
        ordered,
        task: taskM ? taskM[1].toLowerCase() : null,
        text: taskM ? taskM[2] : m[3],
        line: startLine + idx,
      };
    });
    let html = "";
    const stack: { indent: number; tag: "ul" | "ol" }[] = [];
    for (const it of items) {
      const tag: "ul" | "ol" = it.ordered ? "ol" : "ul";
      if (!stack.length || it.indent > stack[stack.length - 1].indent) {
        html += `<${tag}${it.task !== null ? ' class="task-list"' : ""}>`;
        stack.push({ indent: it.indent, tag });
      } else {
        html += "</li>";
        while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) {
          html += `</${stack.pop()!.tag}></li>`;
        }
      }
      const body =
        it.task !== null
          ? `<input type="checkbox" class="task-check" data-line="${it.line}"${it.task === "x" ? " checked" : ""}> ${inline(it.text)}`
          : inline(it.text);
      html += it.task !== null ? `<li class="task-list-item">${body}` : `<li>${body}`;
    }
    html += "</li>";
    while (stack.length) html += `</${stack.pop()!.tag}>`;
    return html;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ``` … ``` (``` + optional language / info string).
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim().toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      const code = buf.join("\n");
      if (lang === "mermaid") {
        // Mermaid's expected container: the reading view lazy-loads mermaid and
        // renders these `.mermaid` nodes to SVG after mount (see core/mermaid.ts).
        // Escaped so the source stays inert text until mermaid reads it back via
        // textContent (entities decode to the original diagram source).
        out.push(`<pre class="mermaid" data-mermaid>${esc(code)}</pre>`);
      } else {
        const cls = lang ? ` class="language-${esc(lang)}"` : "";
        out.push(`<pre><code${cls}>${esc(code)}</code></pre>`);
      }
      continue;
    }

    // Block math: $$ … $$ (KaTeX display mode) — a single `$$x$$` line or a
    // fenced block. Escaped; KaTeX reads it back via textContent after mount.
    if (/^\s*\$\$/.test(line)) {
      const single = /^\s*\$\$(.+?)\$\$\s*$/.exec(line);
      if (single) {
        out.push(`<div class="math-block" data-math>${esc(single[1].trim())}</div>`);
        i++;
        continue;
      }
      const buf: string[] = [];
      i++; // past the opening $$
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing $$
      out.push(`<div class="math-block" data-math>${esc(buf.join("\n"))}</div>`);
      continue;
    }

    // Blank line — paragraph break.
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Raw HTML block — a line starting with an HTML tag or comment (README
    // badges, <p align="center">, <div>, <picture>, <table>, <!-- … -->). Passed
    // through VERBATIM (no markdown/escape) so GitHub-style HTML renders; the
    // DOMPurify pass in renderMarkdown then strips anything unsafe (script, event
    // handlers, javascript: URLs). The tag-name + boundary requirement avoids
    // catching prose like `<3` or an autolink `<https://…>`. Collected to the
    // next blank line (CommonMark type-6 HTML block: no markdown inside).
    if (/^\s*<(!--|\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/>]|$))/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && !/^\s*$/.test(lines[i])) buf.push(lines[i++]);
      out.push(buf.join("\n"));
      continue;
    }

    // ATX heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} id="${uniqueSlug(headingSlug(h[2]))}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Table (a header line with a pipe, followed by a |---|--- separator that
    // ITSELF contains a pipe — so a plain `Foo | Bar` over a bare `----` rule is
    // NOT misread as a table (R1 M3)).
    if (/\|/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[] = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") rows.push(lines[i++]);
      flushTable(rows);
      continue;
    }

    // Blockquote — collapse consecutive `>` lines. An Obsidian callout is a
    // blockquote whose first line is `[!type] optional title`; render it as a
    // titled callout box (body parsed recursively so it can hold lists, etc.).
    if (/^\s*>/.test(line)) {
      const blockStart = i;
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      const callout = /^\[!([\w-]+)\]([-+]?)\s*(.*)$/.exec(buf[0] ?? "");
      if (callout) {
        const type = callout[1].toLowerCase();
        const fold = callout[2]; // "" static · "-" collapsed · "+" foldable-open
        const title = callout[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
        const body = buf.slice(1).join("\n");
        const titleHtml = `${calloutIconHtml(type)}<span class="callout-title-text">${inline(title)}</span>`;
        // The callout body's first line is the source line after the `[!type]`
        // header, i.e. absolute index lineBase + blockStart + 1 — pass it down so
        // a nested task's data-line stays aligned with the real document line.
        const bodyHtml = body.trim()
          ? `<div class="callout-body">${renderBody(body, lineBase + blockStart + 1)}</div>`
          : "";
        if (fold === "-" || fold === "+") {
          out.push(
            `<details class="callout" data-callout="${esc(type)}"${fold === "+" ? " open" : ""}>` +
              `<summary class="callout-title">${titleHtml}</summary>` +
              bodyHtml +
              "</details>",
          );
        } else {
          out.push(
            `<div class="callout" data-callout="${esc(type)}">` +
              `<div class="callout-title">${titleHtml}</div>` +
              bodyHtml +
              "</div>",
          );
        }
      } else {
        // Render the quote body recursively (like a callout) so lists, line breaks,
        // and paragraphs inside `>` survive instead of collapsing into one line.
        out.push(`<blockquote>${renderBody(buf.join("\n"), lineBase + blockStart)}</blockquote>`);
      }
      continue;
    }

    // Lists (unordered or ordered, with nesting). Indented child items belong
    // inside their parent <li>; task items render a checkbox. Gather the whole
    // contiguous run (incl. indented lines) and build the nested tree.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const startLine = i;
      const listLines: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) listLines.push(lines[i++]);
      out.push(renderList(listLines, lineBase + startLine));
      continue;
    }

    // Paragraph — gather until blank / block start (blank, heading, fence,
    // blockquote, list, or a horizontal rule — so `text\n---\ntext` breaks into
    // paragraph · hr · paragraph rather than one merged run).
    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*\$\$/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  // Footnote definitions render as a list at the very bottom; refs above link here.
  if (footnotes.length) {
    out.push('<section class="footnotes"><hr><ol>');
    for (const fn of footnotes) {
      out.push(
        `<li id="fn-${esc(fn.id)}">${inline(fn.text)} <a class="fn-back" href="#fnref-${esc(fn.id)}">↩</a></li>`,
      );
    }
    out.push("</ol></section>");
  }

  return out.join("\n");
}

/** Parse a raw note into its frontmatter + rendered-HTML body. */
export function renderMarkdown(src: string): ParsedNote {
  const { frontmatter, body } = splitFrontmatter(src);
  // The markdown passes escape their own text, but raw HTML blocks flow through
  // verbatim (GitHub-style). DOMPurify is the final safety gate: it strips
  // scripts, event handlers, and javascript:/data: URLs while keeping a safe
  // subset. `data-*` + `class` are allowed by default, so the renderer's
  // interactive hooks survive (task checkboxes, wikilinks, mermaid/math nodes,
  // vault image refs); we additionally allow `target` for links.
  const html = DOMPurify.sanitize(renderBody(body), {
    // Keep the renderer's interactive hooks that aren't in DOMPurify's default
    // allowlist: task checkboxes (<input>), heading anchor `id`s, the <details>
    // `open` state, and `target` on links. `data-*` + `class` are allowed by
    // default. Event handlers, scripts, and javascript:/data: URLs are still
    // stripped — DOMPurify only adds these specific safe items.
    ADD_TAGS: ["input"],
    ADD_ATTR: ["id", "open", "target", "type", "checked"],
    // Drop inline `style` entirely (GitHub does the same for user content): it's
    // a CSS-injection surface we don't need — the renderer styles via classes,
    // and README layout uses `align=`, not inline style.
    FORBID_ATTR: ["style"],
    // Keep heading anchor `id`s (used for in-note #heading navigation). This
    // only relaxes DOMPurify's DOM-clobbering guard — script tags, event
    // handlers, and javascript:/data: URLs are STILL stripped. Acceptable for a
    // single-user, local tool rendering the user's own vault notes.
    SANITIZE_DOM: false,
  });
  return { frontmatter, html };
}

/** Markdown file extensions — rendered through the full markdown pipeline. Any
 *  other text file (yaml, json, toml, sh, …) is shown verbatim as a code block,
 *  because markdown parsing would mangle it (collapse its newlines into one
 *  paragraph, turn `- key:` lines into bullet lists). */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

/** Render a vault file for the reading view by extension: a markdown note goes
 *  through {@link renderMarkdown}; every other text file (yaml, json, toml, sh,
 *  …) renders as a formatting-preserving code block. `esc()` makes the body
 *  inert, so the static `<pre><code>` wrapper needs no DOMPurify pass. */
export function renderFile(path: string, content: string): ParsedNote {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) return renderMarkdown(content);
  const langClass = ext ? ` class="language-${esc(ext)}"` : "";
  return { frontmatter: null, html: `<pre><code${langClass}>${esc(content)}</code></pre>` };
}
