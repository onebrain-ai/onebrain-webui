import { describe, it, expect } from "vitest";
import { linkIconHtml } from "./linkicons";
import { renderMarkdown } from "./markdown";

describe("linkIconHtml", () => {
  it("returns a brand icon for a known domain", () => {
    const html = linkIconHtml("https://github.com/onebrain-ai/onebrain-webui");
    expect(html).toContain('data-brand="github"');
    expect(html).toContain("md-linkico");
  });

  it("matches subdomains and strips a leading www.", () => {
    expect(linkIconHtml("https://en.wikipedia.org/wiki/Obsidian")).toContain(
      'data-brand="wikipedia"',
    );
    expect(linkIconHtml("https://www.youtube.com/watch?v=x")).toContain('data-brand="youtube"');
    expect(linkIconHtml("https://claude.ai/chat")).toContain('data-brand="anthropic"');
  });

  it("aws.amazon.com wins over amazon.com (entry-order specificity)", () => {
    expect(linkIconHtml("https://aws.amazon.com/s3/")).toContain('data-brand="aws"');
    expect(linkIconHtml("https://www.amazon.com/dp/B0ABC")).toContain('data-brand="amazon"');
    expect(linkIconHtml("https://foo.amazonaws.com/bucket")).toContain('data-brand="aws"');
  });

  it("covers the newer brand additions", () => {
    expect(linkIconHtml("https://www.microsoft.com/th-th")).toContain('data-brand="microsoft"');
    expect(linkIconHtml("https://shopee.co.th/product/x")).toContain('data-brand="shopee"');
    expect(linkIconHtml("https://someone.substack.com/p/post")).toContain('data-brand="substack"');
    expect(linkIconHtml("https://developers.cloudflare.com/workers/")).toContain(
      'data-brand="cloudflare"',
    );
    expect(linkIconHtml("https://www.apple.com/macbook")).toContain('data-brand="apple"');
    expect(linkIconHtml("https://news.ycombinator.com/item?id=1")).toContain(
      'data-brand="ycombinator"',
    );
  });

  it("returns the generic arrow-out icon for an unknown site", () => {
    const html = linkIconHtml("https://example.com/page");
    expect(html).toContain("md-linkico-generic");
    expect(html).not.toContain("data-brand");
  });

  it("returns nothing for non-http(s) or unparsable hrefs", () => {
    expect(linkIconHtml("mailto:a@b.example")).toBe(""); // parses, wrong protocol
    expect(linkIconHtml("ftp://files.example")).toBe("");
    expect(linkIconHtml("http://[")).toBe(""); // URL constructor throws
  });
});

describe("renderMarkdown external-link icons", () => {
  it("appends exactly one icon to an external link; mailto/relative get none", () => {
    const { html } = renderMarkdown(
      "[ext](https://example.com) [mail](mailto:a@b.example) [rel](/docs/page)",
    );
    expect((html.match(/<svg class="md-linkico/g) ?? []).length).toBe(1);
    expect(html).toContain("md-linkico-generic");
  });

  it("brand mark for a recognised site survives the DOMPurify pass", () => {
    const { html } = renderMarkdown("[wiki](https://en.wikipedia.org/wiki/Obsidian)");
    expect(html).toContain('data-brand="wikipedia"');
    expect(html).toContain("<path"); // svg path kept by the sanitizer
  });

  it("wikilinks still render as spans with no icon", () => {
    const { html } = renderMarkdown("See [[Some Note]] and [site](https://example.com)");
    expect(html).toContain('class="ob-wikilink"');
    // the only icon belongs to the external link, not the wikilink
    expect((html.match(/<svg class="md-linkico/g) ?? []).length).toBe(1);
  });
});
