// Lazy mermaid renderer for the reading view.
//
// mermaid is large, so it is loaded as its OWN chunk via dynamic import() and
// only ever fetched when a note actually contains a `.mermaid` block — never on
// initial app load. `renderMarkdown` emits each ```mermaid fence as
// `<pre class="mermaid" data-mermaid>…source…</pre>`; this turns those into SVG.

let initialized = false;

/** Find every un-rendered mermaid block under `root` and render it to SVG.
 *  No-op when there are none (so mermaid is not even imported). Malformed
 *  diagrams are left as mermaid's own inline error box rather than thrown. */
export async function renderMermaidIn(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid[data-mermaid]"));
  if (nodes.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  if (!initialized) {
    // `strict` sanitizes diagram-authored HTML; we never auto-run on load.
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    initialized = true;
  }

  // mermaid skips nodes flagged `data-processed`; clear it so a re-rendered
  // reading view (fresh innerHTML each time) renders again from the source text.
  for (const n of nodes) n.removeAttribute("data-processed");
  try {
    await mermaid.run({ nodes });
  } catch {
    /* a malformed diagram — mermaid writes its own error box into the node */
  }
}
