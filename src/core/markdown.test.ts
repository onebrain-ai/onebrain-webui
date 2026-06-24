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
    expect(html).toContain("<h1>Body</h1>");
    expect(html).not.toContain("title: Hi");
  });

  it("renders headings, bold, italic and inline code", () => {
    expect(html("## Heading")).toContain("<h2>Heading</h2>");
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

  it("falls back to a plain blockquote when there is no callout marker", () => {
    const out = html("> just a quote");
    expect(out).toContain("<blockquote>");
    expect(out).not.toContain("callout");
  });

  it("renders a task list with checkbox state", () => {
    const out = html("- [ ] open\n- [x] done");
    expect(out).toContain('class="task-list"');
    expect(out).toContain('<input type="checkbox" disabled> open');
    expect(out).toContain('<input type="checkbox" disabled checked> done');
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
