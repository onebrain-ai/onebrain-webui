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
  let s = esc(text);
  // Pull inline code spans out first so the emphasis passes can't format their
  // interior — code must be verbatim. Inert NUL-delimited placeholders carry no
  // markdown metacharacter, so every pass below skips over them.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Emphasis BEFORE links/wikilinks. Run early so a `*`/`~~`/`==` inside a link or
  // wikilink decorates the visible label — and so the link/wikilink attribute
  // values below (which are tag-stripped via attrSafe) never carry a dangling
  // delimiter that a later pass would turn into a tag inside the attr.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // The italic opener must NOT be preceded by a word char and its content must
  // not start with whitespace — so `2*3*4` / `a*b*c` (math, intra-word) don't
  // become italics, while `a *word* b` and `*lead*` do (R2).
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  // Obsidian extras: ~~strikethrough~~ and ==highlight==.
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  // Restore code spans (verbatim) before the link passes, so a `code` span inside
  // a link label renders while attrSafe still strips the <code> from the attr.
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  // Images / links: ![alt](url) handled as links' text; [text](url). attrSafe
  // strips any markup the passes above left inside the captured href.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, href) => {
    const clean = attrSafe(href);
    const safe = /^https?:|^mailto:|^\//.test(clean) ? clean : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  // [[wikilink]] and [[link|alias]] → a span the Preview wires for navigation.
  // The label keeps its emphasis; data-wikilink is the clean (tag-stripped) target.
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
    const label = alias ?? target;
    return `<span class="ob-wikilink" data-wikilink="${attrSafe(target.trim())}">${label}</span>`;
  });
  return s;
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

    // Blockquote — collapse consecutive `>` lines. An Obsidian callout is a
    // blockquote whose first line is `[!type] optional title`; render it as a
    // titled callout box (body parsed recursively so it can hold lists, etc.).
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      const callout = /^\[!([\w-]+)\]([-+]?)\s*(.*)$/.exec(buf[0] ?? "");
      if (callout) {
        const type = callout[1].toLowerCase();
        const fold = callout[2]; // "" static · "-" collapsed · "+" foldable-open
        const title = callout[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
        const body = buf.slice(1).join("\n");
        const titleHtml = `${calloutIconHtml(type)}<span class="callout-title-text">${inline(title)}</span>`;
        const bodyHtml = body.trim() ? `<div class="callout-body">${renderBody(body)}</div>` : "";
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
        out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      }
      continue;
    }

    // Lists (unordered or ordered) — flat; nested handled shallowly. Unordered
    // items may be task items: `- [ ]` (open) / `- [x]` (done).
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? "ol" : "ul";
      const isTaskList = !ordered && /^\s*[-*+]\s+\[[ xX]\]\s/.test(line);
      out.push(`<${tag}${isTaskList ? ' class="task-list"' : ""}>`);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
        if (task) {
          const checked = task[1].toLowerCase() === "x";
          out.push(
            `<li class="task-list-item">` +
              `<input type="checkbox" disabled${checked ? " checked" : ""}> ${inline(task[2])}` +
              "</li>",
          );
        } else {
          out.push(`<li>${inline(item)}</li>`);
        }
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
