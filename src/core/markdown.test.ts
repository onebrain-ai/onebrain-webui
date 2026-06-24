import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";

const html = (src: string) => renderMarkdown(src).html;

describe("renderMarkdown — security (XSS invariants)", () => {
  // These lock the "escape-first" guarantee the renderer's safety rests on.
  // A failure here is a security regression, not a cosmetic one.

  it("escapes raw HTML in body text", () => {
    expect(html("<script>alert(1)</script>")).not.toContain("<script>");
    expect(html("<script>alert(1)</script>")).toContain("&lt;script&gt;");
  });

  it("escapes HTML inside headings, list items, blockquotes and code", () => {
    expect(html("# <img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(html("- <img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(html("> <img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(html("`<img src=x onerror=alert(1)>`")).not.toContain("<img");
    expect(html("```\n<img src=x onerror=alert(1)>\n```")).not.toContain("<img");
  });

  it("neutralises javascript:/data:/vbscript: link hrefs to #", () => {
    for (const scheme of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:msgbox"]) {
      const out = html(`[click](${scheme})`);
      expect(out).toContain('href="#"');
      expect(out.toLowerCase()).not.toContain("javascript:");
      expect(out.toLowerCase()).not.toContain("vbscript:");
      expect(out).not.toContain("data:text/html");
    }
  });

  it("allows http(s)/mailto/relative hrefs", () => {
    expect(html("[a](https://x.com)")).toContain('href="https://x.com"');
    expect(html("[a](mailto:x@y.com)")).toContain('href="mailto:x@y.com"');
    expect(html("[a](/notes/x.md)")).toContain('href="/notes/x.md"');
  });

  it("prevents attribute breakout via quotes in href and wikilink target", () => {
    const link = html('[a](https://x" onmouseover="alert(1))');
    expect(link).not.toContain('onmouseover="alert(1)"');
    const wiki = html('[[a" onmouseover="alert(1)]]');
    expect(wiki).not.toContain('onmouseover="alert');
    // The quote survives only as the escaped entity.
    expect(wiki).toContain("&quot;");
  });
});

describe("renderMarkdown — rendering", () => {
  it("splits YAML frontmatter from the body", () => {
    const { frontmatter, html } = renderMarkdown("---\ntitle: Hi\ntags: [a]\n---\n# Body\n");
    expect(frontmatter).toBe("title: Hi\ntags: [a]");
    expect(html).toContain('<h1 id="body">Body</h1>');
    expect(html).not.toContain("title: Hi");
  });

  it("renders headings, bold, italic and inline code", () => {
    expect(html("## Heading")).toContain('<h2 id="heading">Heading</h2>');
    expect(html("**bold**")).toContain("<strong>bold</strong>");
    expect(html("a *word* b")).toContain("<em>word</em>");
    expect(html("*lead* word")).toContain("<em>lead</em>");
    expect(html("use `code` here")).toContain("<code>code</code>");
  });

  it("does NOT italicize intra-word / math asterisks (R2)", () => {
    expect(html("2*3*4")).not.toContain("<em>");
    expect(html("a*b*c")).not.toContain("<em>");
  });

  it("renders [[wikilinks]] with the target in data-wikilink, alias as text", () => {
    const out = html("see [[Path Convention|the convention]]");
    expect(out).toContain('data-wikilink="Path Convention"');
    expect(out).toContain(">the convention<");
  });

  it("renders fenced code blocks without inner formatting", () => {
    const out = html("```\n**not bold**\n```");
    expect(out).toContain("<pre><code>");
    expect(out).toContain("**not bold**"); // literal, not <strong>
    expect(out).not.toContain("<strong>");
  });

  it("renders a real pipe table", () => {
    const out = html("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>A</th>");
    expect(out).toContain("<td>1</td>");
  });

  it("does NOT misread `Foo | Bar` over a bare rule as a table (R1 M3)", () => {
    const out = html("Foo | Bar\n----------\nbody");
    expect(out).not.toContain("<table>");
    expect(out).toContain("<hr>");
  });

  it("renders unordered and ordered lists", () => {
    const ul = html("- a\n- b");
    expect(ul).toContain("<ul>");
    expect(ul).toContain("<li>a</li>");
    expect(ul).toContain("<li>b</li>");
    expect(ul).toContain("</ul>");
    const ol = html("1. a\n2. b");
    expect(ol).toContain("<ol>");
    expect(ol).toContain("<li>a</li>");
    expect(ol).toContain("</ol>");
  });

  it("renders an Obsidian callout with type + title", () => {
    const out = html("> [!abstract] TL;DR\n> body text");
    expect(out).toContain('data-callout="abstract"');
    expect(out).toContain('class="callout-title"');
    expect(out).toContain("TL;DR");
    expect(out).toContain("body text");
    expect(out).not.toContain("[!abstract]");
  });

  it("gives a callout a type icon", () => {
    const out = html("> [!warning] Heads up\n> body");
    expect(out).toContain('class="callout-icon"');
    expect(out).toContain('class="callout-title-text"');
  });

  it("renders [!type]- collapsed and [!type]+ open as <details>", () => {
    const collapsed = html("> [!warning]- Heads up\n> details here");
    expect(collapsed).toContain('<details class="callout" data-callout="warning">');
    expect(collapsed).toContain('<summary class="callout-title">');
    expect(collapsed).toContain("details here");
    const open = html("> [!tip]+ Pro tip\n> body");
    expect(open).toContain('<details class="callout" data-callout="tip" open>');
  });

  it("renders ~~strikethrough~~ and ==highlight==", () => {
    expect(html("this is ~~gone~~ now")).toContain("<del>gone</del>");
    expect(html("a ==hot== take")).toContain("<mark>hot</mark>");
  });

  it("treats inline code as verbatim (no emphasis formatted inside it)", () => {
    expect(html("`a*b*c`")).toContain("<code>a*b*c</code>");
    expect(html("`a*b*c`")).not.toContain("<em>");
    expect(html("`x==y==z`")).toContain("<code>x==y==z</code>");
    // a number surrounded by spaces must NOT be eaten by the code placeholder
    expect(html("step 3 of 5")).toContain("step 3 of 5");
  });

  it("keeps emphasis out of href / data-wikilink attribute values", () => {
    // emphasis markup inside a link/wikilink must not leak into the attribute.
    expect(html("[[a==b==c]]")).toContain('data-wikilink="abc"');
    expect(html("[[a`b`c]]")).toContain('data-wikilink="abc"');
    expect(html("[a](https://x.com/*a*b)")).toContain('href="https://x.com/ab"');
    // …while the visible label still gets its emphasis.
    expect(html("[[a==b==c]]")).toContain("<mark>b</mark>");
  });

  it("nests lists by indentation, with task checkboxes", () => {
    const out = html("- a\n- b\n  - b1\n  - b2\n- c");
    // child list lives inside its parent <li>, not as a sibling
    expect(out).toContain("<li>b<ul><li>b1</li><li>b2</li></ul></li>");
    const tasks = html("- [ ] open\n  - [x] sub done");
    expect(tasks).toContain('class="task-list"');
    // checkboxes are clickable + carry a data-line for write-back (0-based body line)
    expect(tasks).toContain('<input type="checkbox" class="task-check" data-line="0"> open');
    expect(tasks).toContain('<input type="checkbox" class="task-check" data-line="1" checked> sub done');
  });

  it("gives a task nested in a callout an ABSOLUTE data-line (not callout-relative)", () => {
    // body lines: 0 '# H', 1 '', 2 '> [!note] T', 3 '> - [ ] in callout'
    const out = html("# H\n\n> [!note] T\n> - [ ] in callout");
    expect(out).toContain('data-line="3"'); // real body line, so write-back hits the right line
  });

  it("renders #tags as clickable spans but ignores #1 and URL fragments", () => {
    expect(html("a #project tag")).toContain('<span class="ob-tag" data-tag="project">#project</span>');
    expect(html("nested #area/health")).toContain('data-tag="area/health"');
    expect(html("issue #1 here")).not.toContain("ob-tag");
    expect(html("see http://x.com/p#frag now")).not.toContain("ob-tag");
  });

  it("renders footnotes: ref links to a definition list at the bottom", () => {
    const out = html("text[^1] more.\n\n[^1]: the note");
    expect(out).toContain('<sup class="fn-ref" id="fnref-1"><a href="#fn-1">1</a></sup>');
    expect(out).toContain('<section class="footnotes">');
    expect(out).toContain('<li id="fn-1">the note');
    expect(out).not.toContain("[^1]:"); // definition removed from body
  });

  it("does NOT extract footnote defs inside a code fence (keeps code verbatim)", () => {
    const out = html("```md\n[^1]: not a footnote here\n```");
    expect(out).toContain("[^1]: not a footnote here"); // stays verbatim in the code block
    expect(out).not.toContain('class="footnotes"'); // no spurious footnotes section
  });

  it("gives duplicate headings unique ids", () => {
    const out = html("## Setup\n\ntext\n\n## Setup");
    expect(out).toContain('<h2 id="setup">Setup</h2>');
    expect(out).toContain('<h2 id="setup-2">Setup</h2>');
  });

  it("renders images: external direct, vault-relative + ![[embed]] as placeholders", () => {
    expect(html("![cat](https://x.com/cat.png)")).toContain('<img src="https://x.com/cat.png" alt="cat"');
    expect(html("![dia](attachments/dia.png)")).toContain('<img data-vault-src="attachments/dia.png" alt="dia"');
    expect(html("![[diagram.png]]")).toContain('<img data-vault-embed="diagram.png"');
    // a non-image ![[note]] is NOT an embed (images-only) — left for the wikilink pass
    expect(html("![[some note]]")).not.toContain("data-vault-embed");
  });

  it("renders inline $math$ and block $$math$$ for KaTeX (verbatim)", () => {
    expect(html("euler $e^{i\\pi}+1=0$ ok")).toContain('<span class="math-inline" data-math>e^{i\\pi}+1=0</span>');
    expect(html("$$\\int_0^1 x\\,dx$$")).toContain('<div class="math-block" data-math>');
    expect(html("price $5 and $10 total")).not.toContain("math-inline"); // not math
  });

  it("falls back to a plain blockquote when there is no callout marker", () => {
    const out = html("> just a quote");
    expect(out).toContain("<blockquote>");
    expect(out).not.toContain("callout");
  });

  it("renders a task list with checkbox state", () => {
    const out = html("- [ ] open\n- [x] done");
    expect(out).toContain('class="task-list"');
    expect(out).toContain('<input type="checkbox" class="task-check" data-line="0"> open');
    expect(out).toContain('<input type="checkbox" class="task-check" data-line="1" checked> done');
  });

  it("renders a ```mermaid fence as a mermaid container, not a code block", () => {
    const out = html("```mermaid\ngraph TD\n  A-->B\n```");
    expect(out).toContain('class="mermaid"');
    expect(out).toContain("graph TD");
    expect(out).not.toContain("<code>graph TD");
  });

  it("keeps a normal code fence as <pre><code> with a language class", () => {
    const out = html("```ts\nconst x = 1;\n```");
    expect(out).toContain('<pre><code class="language-ts">');
    expect(out).toContain("const x = 1;");
  });

  it("handles a note that is only frontmatter (empty body)", () => {
    const { frontmatter, html } = renderMarkdown("---\nonly: meta\n---\n");
    expect(frontmatter).toBe("only: meta");
    expect(html.trim()).toBe("");
  });
});
