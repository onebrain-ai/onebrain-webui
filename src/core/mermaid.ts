// Hybrid mermaid renderer for the reading view.
//
// `beautiful-mermaid` is the PRIMARY renderer: synchronous, zero-DOM, themeable
// via CSS variables (so diagrams follow the live light/dark toggle), and much
// lighter than the official engine. It supports six diagram types — flowchart,
// sequence, class, ER, state, and xychart. Anything else (gitGraph, gantt, pie,
// mindmap, journey, timeline, …) — or a supported type whose syntax it chokes on
// — FALLS BACK to the official `mermaid` package, which covers the full set.
//
// Both engines are loaded as their OWN lazy chunks via dynamic import() and are
// only ever fetched when a note actually contains a `.mermaid` block — never on
// initial app load. `renderMarkdown` emits each ```mermaid fence as
// `<pre class="mermaid" data-mermaid>…source…</pre>`; this turns those into SVG.
//
// beautiful-mermaid's SVG output is run through DOMPurify before it touches the
// DOM: the diagram source is vault content, which can arrive via /import or a
// fetched URL, and this injection happens AFTER markdown.ts's sanitize gate, so
// a crafted diagram must not be able to smuggle a script/handler through. (The
// official engine self-sanitizes via `securityLevel: "strict"`.)

import DOMPurify from "dompurify";
import { mountViewport } from "./richviewport";

/** Diagram types `beautiful-mermaid` can render. Header keywords, lowercased.
 *  Everything not here routes straight to the official engine. */
const BM_TYPES = new Set([
  "graph",
  "flowchart",
  "sequencediagram",
  "classdiagram",
  "erdiagram",
  "statediagram",
  "statediagram-v2",
  "xychart",
  "xychart-beta",
]);

/** Theme handoff: pass our DS tokens as CSS vars so the rendered SVG inherits the
 *  app's colours and re-themes live when `[data-theme]` flips — no re-render.
 *  `font` is pinned to the app's bundled family (the webfont @import is stripped
 *  at build time — see vite.config.ts) so diagrams stay offline. */
const BM_OPTS = {
  bg: "var(--color-bg)",
  fg: "var(--color-text)",
  font: "Inter, system-ui, sans-serif",
  transparent: true,
} as const;

/** The diagram-type keyword of a mermaid source, lowercased — `""` if unknown.
 *  Skips a leading YAML frontmatter block and `%%` directives/comments so the
 *  real header line is what gets classified. Exported for unit tests. */
export function mermaidType(src: string): string {
  let text = src.trim();
  // Strip a leading `---\n…\n---` frontmatter block (mermaid config). An UNCLOSED
  // `---` is malformed — return "" (→ official engine renders its own error box)
  // rather than classifying the literal `---` line as a bogus diagram type.
  if (text.startsWith("---")) {
    const close = text.indexOf("\n---", 3);
    if (close === -1) return "";
    const nl = text.indexOf("\n", close + 1);
    text = nl === -1 ? "" : text.slice(nl + 1).trim();
  }
  let inDirective = false; // inside a (possibly multi-line) `%%{ … }%%` init block
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (inDirective) {
      // Skip the rest of a multi-line directive until its `}%%` close, so the
      // directive's inner lines aren't mistaken for the diagram header.
      if (line.includes("}%%")) inDirective = false;
      continue;
    }
    if (line.startsWith("%%")) {
      // `%%{init…}%%` directive or a `%%` comment. A directive that opens (`%%{`)
      // but doesn't close (`}%%`) on the same line spans multiple lines.
      if (line.startsWith("%%{") && !line.includes("}%%")) inDirective = true;
      continue;
    }
    // First token up to whitespace or an opening brace/paren. Hyphens stay so
    // `stateDiagram-v2` and `xychart-beta` classify correctly.
    return line.split(/[\s{(]/, 1)[0].toLowerCase();
  }
  return "";
}

/** True when `beautiful-mermaid` should get first crack at this source (its
 *  header is one of the six types it renders). Everything else → official
 *  engine. Exported for unit tests. */
export function beautifulSupports(src: string): boolean {
  return BM_TYPES.has(mermaidType(src));
}

// Cached module namespaces + one-time official init, so repeated reading-view
// renders don't re-import or re-initialise.
let bmMod: typeof import("beautiful-mermaid") | null = null;
let officialInit = false;

/** Find every un-rendered mermaid block under `root` and render it to SVG.
 *  No-op when there are none (so neither engine is imported). Malformed diagrams
 *  are left as the respective engine's own inline error rather than thrown. */
export async function renderMermaidIn(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid[data-mermaid]"));
  if (nodes.length === 0) return;
  // Clear any prior `data-processed` flag so a fresh innerHTML re-renders.
  for (const n of nodes) n.removeAttribute("data-processed");

  // Pass 1 — beautiful-mermaid for the types it supports.
  const fallback: HTMLElement[] = [];
  const candidates = nodes.filter((n) => beautifulSupports(/* v8 ignore next */ n.textContent ?? "")); // textContent never null on Element
  if (candidates.length > 0) {
    try {
      const { renderMermaidSVG } = (bmMod ??= await import("beautiful-mermaid"));
      for (const n of candidates) {
        try {
          const svg = renderMermaidSVG(/* v8 ignore next */ n.textContent ?? "", BM_OPTS); // textContent never null on Element
          // DOMPurify strips scripts/handlers and sanitises the inline `style=`
          // attributes (where a diagram's own `classDef`/`style` directives land).
          // beautiful-mermaid's THEMING lives in a generated `<style>` block
          // (derived `--_text`/`--_line`/… via `color-mix` on `--bg`/`--fg`), so
          // FORBID_TAGS:['style'] would break theming — instead we keep `<style>`
          // and additionally scrub the only CSS constructs that could reach an
          // external resource (`@import` / `url(http…)`), which legitimate diagram
          // output never contains. (The webfont @import is also stripped at build.)
          n.innerHTML = DOMPurify.sanitize(svg)
            .replace(/@import[^;]*;?/gi, "")
            .replace(/url\(\s*['"]?\s*https?:\/\/[^)]*\)/gi, "none");
          n.setAttribute("data-processed", "bm");
        } catch {
          // Supported header but syntax it couldn't handle → official engine.
          fallback.push(n);
        }
      }
    } catch {
      // The whole beautiful-mermaid chunk failed to load → official for all.
      fallback.push(...candidates);
    }
  }

  // Pass 2 — official mermaid for unsupported types + anything beautiful punted.
  const officialNodes = nodes.filter((n) => !n.hasAttribute("data-processed") || fallback.includes(n));
  if (officialNodes.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  if (!officialInit) {
    // `strict` sanitizes diagram-authored HTML; we never auto-run on load.
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    officialInit = true;
  }
  // mermaid skips nodes flagged `data-processed`; clear it so it renders.
  for (const n of officialNodes) n.removeAttribute("data-processed");
  try {
    await mermaid.run({ nodes: officialNodes });
  } catch {
    /* a malformed diagram — mermaid writes its own error box into the node */
  }
}

// ── Full-screen pan/zoom for rendered diagrams ──────────────────────────────
const ZICON = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const EXPAND_ICON = ZICON('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/>');
const CLOSE_ICON = ZICON('<path d="M6 6l12 12M18 6L6 18"/>');

/** Add a hover "open full screen" button to each rendered mermaid diagram. The
 *  button opens a pan/zoom/fit overlay (the shared richviewport). Idempotent, so
 *  it's safe to re-run after every reading render. */
export function addMermaidZoomControls(root: HTMLElement): void {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid"))) {
    const svg = node.querySelector("svg");
    if (!svg || node.querySelector(":scope > .mermaid-expand")) continue;
    node.classList.add("mermaid-zoomable");
    const btn = document.createElement("button");
    btn.className = "mermaid-expand";
    btn.type = "button";
    btn.title = "Open full screen";
    btn.setAttribute("aria-label", "Open full screen");
    btn.innerHTML = EXPAND_ICON; // static markup, no diagram/user content
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMermaidOverlay(svg);
    });
    node.appendChild(btn);
  }
}

/** Clone the diagram into a full-viewport overlay with pan/zoom/fit/fullscreen
 *  (richviewport) and a close button (× / Esc). */
function openMermaidOverlay(source: SVGElement): void {
  const overlay = document.createElement("div");
  overlay.className = "mermaid-overlay";
  const frame = document.createElement("div");
  frame.className = "mermaid-overlay-frame";
  const content = document.createElement("div");
  content.className = "mermaid-overlay-content";
  content.appendChild(source.cloneNode(true)); // the already-sanitised diagram SVG
  frame.appendChild(content);
  overlay.appendChild(frame);

  const close = document.createElement("button");
  close.className = "mermaid-overlay-close";
  close.type = "button";
  close.title = "Close (Esc)";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = CLOSE_ICON; // static markup
  overlay.appendChild(close);

  document.body.appendChild(overlay);
  const handle = mountViewport(frame, content);
  const dismiss = () => {
    handle.destroy();
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismiss();
  };
  close.addEventListener("click", dismiss);
  document.addEventListener("keydown", onKey);
}
