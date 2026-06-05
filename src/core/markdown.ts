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

export interface ParsedNote {
  /** Raw YAML frontmatter block (without the `---` fences), or null. */
  frontmatter: string | null;
  /** Rendered HTML for the body (frontmatter stripped). */
  html: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
  let s = esc(text);
  // Inline code first (so its contents aren't further formatted). Backticks
  // survive escaping; capture non-greedily.
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // Images / links: ![alt](url) handled as links' text; [text](url).
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, href) => {
    const safe = /^https?:|^mailto:|^\//.test(href) ? href : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  // [[wikilink]] and [[link|alias]] → a span the Preview wires for navigation.
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
    const label = alias ?? target;
    return `<span class="ob-wikilink" data-wikilink="${target.trim()}">${label}</span>`;
  });
  // Bold then italic (order matters so ** isn't eaten by *). The italic opener
  // must NOT be preceded by a word char and its content must not start with
  // whitespace — so `2*3*4` / `a*b*c` (math, intra-word) don't become italics,
  // while `a *word* b` and `*lead*` do (R2).
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  return s;
}

/** Render the note body (frontmatter already removed) to HTML. */
function renderBody(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

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

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ``` … ```
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Blank line — paragraph break.
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // ATX heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
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

    // Blockquote (collapse consecutive `>` lines).
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Lists (unordered or ordered) — flat; nested handled shallowly.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>`);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        out.push(`<li>${inline(item)}</li>`);
        i++;
      }
      out.push(`</${tag}>`);
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
      !/^\s*>/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return out.join("\n");
}

/** Parse a raw note into its frontmatter + rendered-HTML body. */
export function renderMarkdown(src: string): ParsedNote {
  const { frontmatter, body } = splitFrontmatter(src);
  return { frontmatter, html: renderBody(body) };
}
