// Shared pan / zoom / fullscreen controller for the rich-file viewers (drawio,
// pptx). It transforms a `content` element with CSS (translate + scale) so the
// same interaction model — drag to pan, wheel / Z / buttons to zoom, Space as the
// pan affordance, fullscreen, optional slide nav — works regardless of what engine
// produced the content. Rendered into a plain host (no JSX), so it wires its own
// DOM + listeners and hands back a destroy().

import "./richviewport.css";

const SVG = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  out: SVG('<line x1="5" y1="12" x2="19" y2="12"/>'),
  in: SVG('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  fit: SVG('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>'),
  full: SVG('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  exit: SVG('<path d="M9 3v6H3M21 9h-6V3M15 21v-6h6M3 15h6v6"/>'),
  prev: SVG('<path d="M15 18l-6-6 6-6"/>'),
  next: SVG('<path d="M9 18l6-6-6-6"/>'),
  contrast: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  // All four squares are identical fills (two faint) — mixing stroked and
  // filled rects reads lopsided because the stroke straddles the edge.
  checker: SVG(
    '<rect x="4" y="4" width="7" height="7" fill="currentColor" stroke="none"/><rect x="13" y="13" width="7" height="7" fill="currentColor" stroke="none"/><rect x="13" y="4" width="7" height="7" fill="currentColor" stroke="none" opacity=".35"/><rect x="4" y="13" width="7" height="7" fill="currentColor" stroke="none" opacity=".35"/>',
  ),
};

const PLAIN_KEY = "onebrain.previewPlainBg";

export interface NavOptions {
  prev(): void;
  next(): void;
  label(): string;
}
export interface ViewportHandle {
  refreshLabel(): void;
  destroy(): void;
}

// WebKit-prefixed fullscreen surface (Safari / WKWebView).
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const MIN = 0.2;
const MAX = 8;

/**
 * Mount the viewport controls onto `frame` (a positioned, overflow-hidden box),
 * transforming `content` for pan/zoom.
 * @param onFit  re-fit the underlying engine before the transform resets (drawio
 *               re-runs maxGraph fit; pptx is a no-op).
 * @param nav    when present, adds prev/next slide controls + arrow-key nav.
 */
export function mountViewport(
  frame: HTMLElement,
  content: HTMLElement,
  { onFit, nav, bgToggle }: { onFit?: () => void; nav?: NavOptions; bgToggle?: boolean } = {},
): ViewportHandle {
  frame.classList.add("rich-vframe");
  frame.tabIndex = 0; // focusable, so the keyboard shortcuts fire when it's active
  // optional checkerboard background (light / dark) for transparent content — the
  // initial side follows the app theme; the toolbar button flips it so dark-on-
  // transparent assets (a light-mode logo / diagram) read against a light board.
  let bg: "dark" | "light" =
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  // Checkerboard pattern on/off (off = a flat tone in the chosen dark/light
  // side). Persisted globally — a preference, not a per-file state.
  let plain = false;
  try {
    plain = localStorage.getItem(PLAIN_KEY) === "1";
  } catch {
    /* v8 ignore start -- private-mode localStorage throw; not reliably reproducible across jsdom/CI envs */
    plain = false;
    /* v8 ignore stop */
  }
  const applyBg = () => {
    if (!bgToggle) return;
    frame.classList.toggle("rich-bg-dark", bg === "dark");
    frame.classList.toggle("rich-bg-light", bg === "light");
    frame.classList.toggle("rich-bg-plain", plain);
  };
  applyBg();
  let scale = 1;
  let tx = 0;
  let ty = 0;
  content.style.transformOrigin = "0 0";
  const apply = () => {
    content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  // Zoom by `factor` while keeping the frame-local point (px, py) stationary.
  const zoomAt = (factor: number, px: number, py: number) => {
    const next = Math.max(MIN, Math.min(MAX, scale * factor));
    const r = next / scale;
    tx = px - (px - tx) * r;
    ty = py - (py - ty) * r;
    scale = next;
    apply();
  };
  const centerZoom = (factor: number) => {
    const r = frame.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  };
  const fit = () => {
    onFit?.();
    // Scale the content to fit the frame (with breathing room) and centre it,
    // measured from the content's natural size — so it works whether the content
    // already fills the frame (drawio / image) or has its own size (a pptx slide).
    const pad = 0.9;
    const fr = frame.getBoundingClientRect();
    content.style.transform = "none";
    const cw = content.offsetWidth || fr.width;
    const ch = content.offsetHeight || fr.height;
    scale = Math.min((fr.width / cw) * pad, (fr.height / ch) * pad, MAX);
    tx = (fr.width - cw * scale) / 2;
    ty = (fr.height - ch * scale) / 2;
    apply();
  };

  // ── toolbar ────────────────────────────────────────────────────────────────
  const btn = (a: string, icon: string, title: string) =>
    `<button class="rich-vbtn" data-a="${a}" type="button" title="${title}" aria-label="${title}">${icon}</button>`;
  const sep = '<span class="rich-vsep"></span>';
  const bar = document.createElement("div");
  bar.className = "rich-vbar";
  // Static markup — only our own ICON constants + fixed titles/labels are
  // interpolated (no file/user content), so this innerHTML carries no XSS risk.
  // The dynamic slide label is set via textContent below.
  bar.innerHTML =
    (nav ? btn("prev", ICON.prev, "Previous slide (←)") + '<span class="rich-vlabel"></span>' + btn("next", ICON.next, "Next slide (→)") + sep : "") +
    btn("out", ICON.out, "Zoom out (−)") +
    btn("fit", ICON.fit, "Fit (0)") +
    btn("in", ICON.in, "Zoom in (+)") +
    sep +
    (bgToggle
      ? btn("bg", ICON.contrast, "Toggle background (light / dark)") +
        btn("pattern", ICON.checker, "Toggle checkerboard / plain background")
      : "") +
    btn("full", ICON.full, "Full screen (F)");
  frame.appendChild(bar);

  const labelEl = bar.querySelector<HTMLElement>(".rich-vlabel");
  const fullBtn = bar.querySelector<HTMLElement>('[data-a="full"]');
  const refreshLabel = () => {
    if (labelEl && nav) labelEl.textContent = nav.label();
  };
  refreshLabel();

  // Fullscreen with a WebKit fallback: Safari and embedded WKWebViews (the
  // Studio surface, Obsidian's viewer, etc.) expose only the webkit-prefixed
  // API, so the unprefixed calls silently no-op there — the button would
  // "expand within the page" but never enter real screen fullscreen.
  const fsElement = (): Element | null =>
    document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
  const toggleFull = () => {
    if (fsElement()) {
      const exit = document.exitFullscreen ?? (document as FsDoc).webkitExitFullscreen;
      if (exit) exit.call(document);
    } else {
      const req = frame.requestFullscreen ?? (frame as FsEl).webkitRequestFullscreen;
      if (req) req.call(frame);
    }
  };
  const onFsChange = () => {
    const on = fsElement() === frame;
    frame.classList.toggle("is-full", on);
    /* v8 ignore start */
    if (fullBtn) fullBtn.innerHTML = on ? ICON.exit : ICON.full; // fullBtn always present
    /* v8 ignore stop */
    // The frame just resized to / from the screen — re-fit to the new bounds.
    // Layout settles a beat AFTER the fullscreenchange event (especially on
    // EXIT, where the frame shrinks back into the pane): a single rAF can still
    // read the old fullscreen rect and "fit" to the wrong size, stranding the
    // content zoomed past the pane. Fit on the next two frames AND after a
    // settle timeout — fit() is idempotent, so the extra passes are free.
    requestAnimationFrame(() => requestAnimationFrame(fit));
    setTimeout(fit, 150);
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);

  bar.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("button")?.dataset.a;
    if (a === "in") centerZoom(1.25);
    else if (a === "out") centerZoom(0.8);
    else if (a === "fit") fit();
    else if (a === "full") toggleFull();
    else if (a === "bg") { bg = bg === "dark" ? "light" : "dark"; applyBg(); }
    else if (a === "pattern") {
      plain = !plain;
      try {
        localStorage.setItem(PLAIN_KEY, plain ? "1" : "0");
      } catch {
        /* private mode — the toggle still applies in-session */
      }
      applyBg();
    }
    else if (a === "prev") { nav?.prev(); refreshLabel(); }
    else if (a === "next") { nav?.next(); refreshLabel(); }
  });

  // ── drag to pan ──────────────────────────────────────────────────────────────
  let dragging = false;
  let lx = 0;
  let ly = 0;
  const onDown = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".rich-vbar")) return;
    frame.focus({ preventScroll: true }); // take keyboard focus so shortcuts work
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    frame.classList.add("is-grabbing");
    e.preventDefault();
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    tx += e.clientX - lx;
    ty += e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
    apply();
  };
  const onUp = () => {
    dragging = false;
    frame.classList.remove("is-grabbing");
  };
  frame.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  // ── wheel to zoom (toward the cursor) ────────────────────────────────────────
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = frame.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left, e.clientY - r.top);
  };
  frame.addEventListener("wheel", onWheel, { passive: false });

  // ── keyboard (only while this viewer is hovered or focused) ───────────────────
  const active = () =>
    document.activeElement === frame ||
    frame.contains(document.activeElement) ||
    frame.matches(":hover") ||
    document.fullscreenElement === frame;
  const onKey = (e: KeyboardEvent) => {
    if (!active()) return;
    const k = e.key;
    if (k === "z" || k === "Z") { e.shiftKey ? centerZoom(0.8) : centerZoom(1.25); }
    else if (k === "+" || k === "=") centerZoom(1.25);
    else if (k === "-" || k === "_") centerZoom(0.8);
    else if (k === "0") fit();
    else if (k === "f" || k === "F") toggleFull();
    else if (k === " ") frame.classList.add("is-pannable");
    else if (nav && (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown")) { nav.next(); refreshLabel(); }
    else if (nav && (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp")) { nav.prev(); refreshLabel(); }
    else return;
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") frame.classList.remove("is-pannable");
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);

  fit(); // initial view: fitted with padding
  frame.focus({ preventScroll: true }); // ready for keyboard shortcuts immediately

  return {
    refreshLabel,
    destroy() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      frame.removeEventListener("wheel", onWheel);
      // The toolbar + frame classes/attrs are imperative DOM — remove them
      // explicitly. Preact may REUSE the host div for the next file's branch
      // (e.g. an image's .ed-mediawrap reused as .ed-richwrap) rather than
      // unmounting it, which would otherwise strand the old toolbar.
      bar.remove();
      frame.classList.remove("rich-vframe", "is-pannable", "is-grabbing", "is-full", "rich-bg-dark", "rich-bg-light", "rich-bg-plain");
      frame.removeAttribute("tabindex");
    },
  };
}
