// Pretty-print structured source (JSON / YAML / XML) for read-only previews. The
// source-file view and the reading view's fenced code blocks share this so both
// format consistently. Anything else — or a parse error — is returned unchanged.

/** Pretty-print `text` when `lang` is a structured format we can safely reformat
 *  (json / yaml / xml family); otherwise return it as-is. Never throws. */
export async function formatCode(lang: string, text: string): Promise<string> {
  const e = lang.toLowerCase();
  try {
    if (e === "json" || e === "jsonc") return JSON.stringify(JSON.parse(text), null, 2);
    if (e === "yaml" || e === "yml") {
      const { loadAll, dump } = await import("js-yaml");
      return (loadAll(text) as unknown[])
        .map((d) => dump(d, { indent: 2, lineWidth: 100, noRefs: true }))
        .join("---\n")
        .trimEnd();
    }
    if (e === "xml" || e === "xsd" || e === "xsl" || e === "rss" || e === "plist") return formatXml(text);
  } catch {
    /* malformed → show as-is */
  }
  return text;
}

/** Indent an XML document for preview; unchanged on a parse error. */
export function formatXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) return xml;
  const ser = (node: Element, depth: number): string => {
    const pad = "  ".repeat(depth);
    const attrs = Array.from(node.attributes)
      .map((a) => ` ${a.name}="${a.value}"`)
      .join("");
    const els = Array.from(node.children);
    const txt = Array.from(node.childNodes)
      .filter((c) => c.nodeType === 3)
      .map((c) => c.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (els.length === 0) {
      return txt
        ? `${pad}<${node.tagName}${attrs}>${txt}</${node.tagName}>`
        : `${pad}<${node.tagName}${attrs} />`;
    }
    const inner = els.map((c) => ser(c, depth + 1)).join("\n");
    return `${pad}<${node.tagName}${attrs}>\n${inner}\n${pad}</${node.tagName}>`;
  };
  return ser(doc.documentElement, 0);
}
