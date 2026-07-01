// Lazy KaTeX renderer for the reading view.
//
// KaTeX (+ its stylesheet) is loaded as its OWN chunk via dynamic import() and
// only fetched when a note actually contains math — never on initial app load.
// `renderMarkdown` emits `<span class="math-inline" data-math>…</span>` and
// `<div class="math-block" data-math>…</div>`; this renders those in place.

/** Render every un-rendered math node under `root`. No-op (and no KaTeX import)
 *  when there are none. Malformed TeX renders KaTeX's own inline error, not a throw. */
export async function renderMathIn(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-math]"));
  if (nodes.length === 0) return;

  const { default: katex } = await import("katex");
  await import("katex/dist/katex.min.css");

  for (const n of nodes) {
    const tex = (/* v8 ignore next */ n.textContent ?? ""); // textContent never null on Element
    const displayMode = n.classList.contains("math-block");
    try {
      katex.render(tex, n, { displayMode, throwOnError: false });
    } catch {
      /* malformed — with throwOnError:false KaTeX writes its own error span */
    }
    // Mark done so a re-rendered reading view (fresh innerHTML) doesn't re-process
    // an already-rendered node, and an empty pass stays a no-op.
    n.removeAttribute("data-math");
  }
}
