import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, LanguageDescription } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { showMinimap } from "@replit/codemirror-minimap";
import { languages } from "@codemirror/language-data";
import DOMPurify from "dompurify";
import type { PanelDef, PanelContext } from "../contract";
import { previewPath, resolveWikilink, resolveAsset, navBack, navForward, canNavBack, canNavForward } from "../bus";
import { openSearch, htmlAutorun, mediaAutoplay, theme, accent } from "../../core/stores";
import { loadTasks } from "../tasks-store";
import { Autosaver, saveStatus, dirty, conflictRev } from "../../core/autosave";
import { editorBridge } from "../../core/editor-bridge";
import { splitNote, parseFrontmatter, compose } from "../../core/frontmatter";
import { Properties } from "./properties";
import { livePreview } from "./live-preview/plugin";
import { renderFile } from "../../core/markdown";
import { isRichFile, renderRichFile, richLabel } from "../../core/richfile";
import { mountViewport } from "../../core/richviewport";
import { renderMermaidIn, addMermaidZoomControls } from "../../core/mermaid";
import { renderMathIn } from "../../core/katex";
import { enhanceCodeBlocksIn } from "../../core/codeblock";
import { formatCode } from "../../core/codeformat";
import { Icon } from "../../ui/Icon";
import "./editor.css";

/** Binary file types with no in-app preview — shown as an icon + Download button
 *  instead of being force-loaded as text (which would fail / show garbage). Any
 *  other non-UTF-8 file is caught at load time and falls back the same way. */
const UNPREVIEWABLE_EXT = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
  "exe", "dmg", "app", "pkg", "deb", "rpm", "msi", "bin", "iso", "wasm",
  "avi", "mkv", "wmv", "flv",
  "woff", "woff2", "ttf", "otf", "eot",
  "psd", "ai", "sketch", "fig", "xd", "eps",
  "blend", "obj", "stl", "fbx", "glb", "gltf",
  "db", "sqlite", "sqlite3", "dat", "pyc", "class", "so", "dll", "dylib", "parquet",
]);

/** Audio / video previewed with a native <video>/<audio> player. The daemon serves
 *  these with the right MIME + Range support (seeking / Safari). Non-web codecs
 *  (avi/mkv/wmv/flv) stay in UNPREVIEWABLE_EXT — the browser can't play them. */
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "ogv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac"]);

/**
 * The run-function wired to the Mod-s keybinding.
 * Exported so tests can invoke it directly (jsdom does not propagate key events
 * through CodeMirror's event handler chain, so fireEvent.keyDown cannot reach it).
 * In production this is called by CodeMirror; the `sv` closure is set per-load.
 */
export let _cmdSaveRun: (() => boolean) | null = null;

/** Sanitize an untrusted vault SVG before it's injected inline into the *page*
 *  DOM (it renders inline, not via `<img>`, so the page's web fonts apply). Vault
 *  files are untrusted (imported / AI-generated / synced), so we run them through
 *  DOMPurify's SVG profile — a maintained allowlist hardened against mutation-XSS,
 *  far safer than a hand-rolled denylist (which can miss namespaced elements,
 *  `<style>` beacons, and the XML→HTML reparse mismatch). Returns "" for empty or
 *  unparseable input. */
function sanitizeSvg(s: string): string {
  return DOMPurify.sanitize(s, { USE_PROFILES: { svg: true, svgFilters: true } });
}

/** Inline save indicator for the editor header (markdown notes only). */
function SaveBadge() {
  const s = saveStatus.value;
  const state = s === "idle" ? (dirty.value ? "unsaved" : "saved") : s;
  const view: Record<string, preact.JSX.Element> = {
    saving: <><span class="ed-dot saving" />Saving…</>,
    unsaved: <><span class="ed-dot" />Unsaved</>,
    saved: <><Icon name="check" />Saved</>,
    conflict: <><Icon name="alert" />Conflict</>,
    error: <><Icon name="alert" />Save failed</>,
  };
  return <span class={`ed-save st-${state}`}>{view[state]}</span>;
}

function Editor({ ctx }: { ctx: PanelContext }) {
  const host = useRef<HTMLDivElement>(null);
  const readingHost = useRef<HTMLDivElement>(null);
  // A heading anchor to scroll to once the next reading render lands (set when a
  // [[note#heading]] link is clicked, consumed by the reading-render effect).
  const pendingHeading = useRef<string | null>(null);
  const mediaFrameRef = useRef<HTMLDivElement>(null);
  const mediaContentRef = useRef<HTMLDivElement>(null);
  const richHost = useRef<HTMLDivElement>(null);
  const richErr = useSignal("");
  const view = useRef<EditorView | null>(null);
  const sourceHost = useRef<HTMLDivElement>(null);
  const sourceView = useRef<EditorView | null>(null);
  const saver = useRef<Autosaver | null>(null);
  const fm = useRef<{ raw: string | null; obj: Record<string, unknown>; edited: boolean }>({
    raw: null,
    obj: {},
    edited: false,
  });
  const props = useSignal<Record<string, unknown>>({});
  // Default to the rendered reading view on open (toggle to edit with the button).
  const reading = useSignal(true);
  // Current doc text, mirrored into a signal so the reading view (markdown) or
  // the iframe srcdoc (html) re-renders when the note loads or is edited.
  const docText = useSignal("");
  // Sanitized markup for an inline SVG preview (rendered into the DOM, NOT via an
  // <img>, so it can use the page's web fonts — an <img>-embedded SVG cannot).
  const svgHtml = useSignal("");
  // Image zoom: `fit` = scale to the pane; otherwise a numeric factor of intrinsic.
  // Set when a file can't be shown as text (binary) — render an icon + Download.
  const unpreviewable = useSignal(false);
  // .md reading view: false = centred column, true = full-width (wide-screen tables).
  const wideView = useSignal(false);
  // Source-preview font zoom (1 = base) — +/− and Cmd-wheel resize the code.
  const sourceFontScale = useSignal(1);
  // HTML preview: false = sandboxed (scripts off), true = "Run" (allow-scripts).
  const htmlInteractive = useSignal(false);
  // Source-preview copy button: brief "copied" tick.
  const sourceCopied = useSignal(false);
  // Per-preview background theme (source / text / csv / tsv / docx / xlsx / ipynb).
  // Defaults to the app theme; the ◐ toolbar button flips it. Persists across files.
  const previewTheme = useSignal<"light" | "dark">(theme.peek());
  // --section-accent is resolved once at :root (to the dark accent), so a
  // data-pv-theme subtree inherits the bright value even after it re-tints --acc-*.
  // Re-declare the accent vars on the preview wrapper so they re-resolve against
  // the subtree's (theme-correct) --acc-* — keeps the accent legible on a light bg.
  const pvAccentStyle =
    `--section-accent:var(--acc-${accent.value});` +
    `--accent-weak:color-mix(in oklab,var(--acc-${accent.value}) 14%,transparent);` +
    `--accent-line:color-mix(in oklab,var(--acc-${accent.value}) 32%,transparent)`;

  const path = previewPath.value;
  const ext = path ? (/* v8 ignore next -- pop() never returns undefined for a non-empty string */ path.split(".").pop() ?? "").toLowerCase() : "";
  // Non-text files preview read-only — no CodeMirror, no autosave, no frontmatter.
  const isHtml = ext === "html" || ext === "htm";
  const isSvg = ext === "svg";
  const isImage = isSvg || ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"].includes(ext);
  const isPdf = ext === "pdf";
  const isVideo = VIDEO_EXT.has(ext);
  const isAudio = AUDIO_EXT.has(ext);
  const isBinary = isImage || isPdf;
  // Rich (Office / drawio) files preview read-only via richfile.ts, like binaries.
  const isRich = isRichFile(/* v8 ignore next -- path is always truthy here (guarded above) */ path ?? "");
  // Rich files that get the ◐ background toggle (docs/tables/notebooks). pptx +
  // drawio are excluded — they have their own bg toggle in the viewport.
  const isDocPreview = ["xlsx", "csv", "tsv", "docx", "ipynb"].includes(ext);
  // Known-binary extension → never attempt a text preview (icon + Download instead).
  const isUnpreviewableExt = UNPREVIEWABLE_EXT.has(ext);
  const isMarkdown = ext === "md" || ext === "markdown";
  // Any other text file (source / config / data) → read-only syntax view with line
  // numbers + minimap. Binaries that slip through fall back via the load-time catch.
  const isSourceText =
    !isMarkdown && !isBinary && !isHtml && !isRich && !isUnpreviewableExt && !isVideo && !isAudio;

  useEffect(() => {
    if (!path) return;
    // Each note starts clean — clear any prior note's save/conflict state so a
    // stale toast/indicator can't carry over to a different note.
    saveStatus.value = "idle";
    dirty.value = false;
    conflictRev.value = null;
    unpreviewable.value = false;
    htmlInteractive.value = htmlAutorun.peek(); // follow the Settings "Run HTML scripts" toggle; "Run" overrides per-file
    let cancelled = false;

    if (isHtml) {
      editorBridge.value = null;
      props.value = {};
      docText.value = ""; // don't flash the prior note's content into the iframe
      void ctx.daemon.file(path).then((f) => {
        if (cancelled) return;
        docText.value = f.content;
      });
      return () => {
        cancelled = true;
        editorBridge.value = null;
      };
    }

    if (isBinary) {
      // Read-only preview — no editor/autosaver (a preview must never write back).
      editorBridge.value = null;
      props.value = {};

      if (isSvg) {
        // Inline the SVG so it renders with the page's fonts (Chakra Petch / etc).
        svgHtml.value = "";
        void ctx.daemon.file(path).then((f) => {
          if (cancelled) return;
          svgHtml.value = sanitizeSvg(f.content);
        });
        return () => {
          cancelled = true;
          editorBridge.value = null;
        };
      }

      // Raster image / PDF render straight from the daemon URL — the CSP allows
      // `'self'` but not `blob:` on img-src, so a blob: object URL won't load.
      return () => {
        cancelled = true;
        editorBridge.value = null;
      };
    }

    if (isRich) {
      // Read-only rich preview — no CodeMirror / autosaver / text load. The
      // dedicated rich effect below fetches the bytes and renders into richHost.
      editorBridge.value = null;
      props.value = {};
      docText.value = "";
      return () => {
        cancelled = true;
        editorBridge.value = null;
      };
    }

    if (isVideo || isAudio) {
      // Played by a native <video>/<audio> element straight from the daemon URL —
      // no text to load, no editor.
      editorBridge.value = null;
      props.value = {};
      docText.value = "";
      return () => {
        cancelled = true;
        editorBridge.value = null;
      };
    }

    if (!host.current) return;
    void ctx.daemon.file(path).then((f) => {
      if (cancelled || !host.current) return;
      const split = splitNote(f.content);
      const obj = parseFrontmatter(split.raw);
      fm.current = { raw: split.raw, obj, edited: false };
      props.value = obj;
      const sv = new Autosaver(ctx.daemon, {
        path,
        rev: f.rev,
        // view.current is always mounted when the autosaver composes; the ?./?? are belt-and-braces.
        /* v8 ignore next */ compose: () => compose(fm.current, view.current?.state.doc.toString() ?? ""),
      });
      saver.current = sv;
      const cmdSaveRun = () => { void sv.flush(); return true; };
      _cmdSaveRun = cmdSaveRun;
      view.current?.destroy();
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: split.body,
          extensions: [
            EditorView.lineWrapping,
            // Accessible name for the editor's ARIA textbox (WCAG 4.1.2).
            EditorView.contentAttributes.of({ "aria-label": "Note editor" }),
            // A drawn cursor + active-line highlight so you can always see where
            // the caret is on the dark theme (the native caret is near-invisible).
            drawSelection(),
            highlightActiveLine(),
            keymap.of([
              { key: "Mod-s", run: cmdSaveRun },
              ...defaultKeymap,
            ]),
            markdown({ base: markdownLanguage }),
            livePreview(),
            EditorView.updateListener.of((u) => {
              /* v8 ignore start -- CodeMirror fires non-doc updates (selection/viewport) that can't be triggered under jsdom */
              if (u.docChanged) { /* v8 ignore stop */
                sv.schedule();
                docText.value = u.state.doc.toString();
              }
            }),
          ],
        }),
      });
      docText.value = split.body;
      // Always land at the top of a freshly-opened note (the reading view div is
      // reused across notes, so its scroll would otherwise carry over).
      requestAnimationFrame(() => { if (readingHost.current) readingHost.current.scrollTop = 0; });
      const reload = async () => {
        const f2 = await ctx.daemon.file(path);
        if (cancelled || previewPath.value !== path) return; // note switched mid-reload — abandon
        const myView = view.current;
        /* v8 ignore start -- view is always set when reload() is called (set just above in the same tick) */
        if (!myView) return; /* v8 ignore stop */
        const s2 = splitNote(f2.content);
        fm.current = { raw: s2.raw, obj: parseFrontmatter(s2.raw), edited: false };
        props.value = fm.current.obj;
        sv.adoptRev(f2.rev);
        myView.dispatch({ changes: { from: 0, to: myView.state.doc.length, insert: s2.body } });
        conflictRev.value = null;
        dirty.value = false;
        saveStatus.value = "saved";
      };
      editorBridge.value = { overwrite: () => sv.overwrite(), reload };
    }).catch(() => {
      // Not UTF-8 text (binary) or unreadable → show an icon + Download instead.
      if (!cancelled) unpreviewable.value = true;
    });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
      editorBridge.value = null;
      _cmdSaveRun = null;
    };
  }, [path]);

  // Image / SVG preview: mount the shared pan-zoom-fullscreen viewport on the frame.
  useEffect(() => {
    if (!(isSvg || isImage) || !mediaFrameRef.current || !mediaContentRef.current) return;
    const handle = mountViewport(mediaFrameRef.current, mediaContentRef.current, { bgToggle: true });
    return () => handle.destroy();
  }, [path]);

  // Source / code / config text: read-only CodeMirror with syntax highlighting,
  // line numbers, and a minimap. json/yaml/xml are pretty-printed first.
  useEffect(() => {
    if (!isSourceText || !sourceHost.current) return;
    let cancelled = false;
    const minimapCompartment = new Compartment();
    const makeMinimap = () =>
      showMinimap.of({
        create: () => ({ dom: document.createElement("div") }),
        displayText: "blocks",
        showOverlay: "always",
      });
    // Safari/WebKit can leave the minimap canvas blank after the editor box resizes
    // (e.g. a window maximise) — changing canvas dimensions doesn't always force a
    // repaint. Re-init the minimap (fresh config) once the resize settles.
    let resizeT: ReturnType<typeof setTimeout> | undefined;
    let lastW = -1;
    let lastH = -1;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r) return;
      const first = lastW < 0;
      // Only a REAL box resize should re-init. Skip the initial observe + sub-pixel
      // / scrollbar jitter so scrolling never re-inits (which would flash the
      // minimap on Safari). The minimap is already created at the opening size.
      if (!first && Math.abs(r.width - lastW) < 3 && Math.abs(r.height - lastH) < 3) return;
      lastW = r.width;
      lastH = r.height;
      if (first) return;
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        sourceView.current?.dispatch({ effects: minimapCompartment.reconfigure(makeMinimap()) });
      }, 200);
    });
    void ctx.daemon
      .file(path)
      .then(async (f) => {
        if (cancelled || !sourceHost.current) return;
        const text = await formatCode((/* v8 ignore next -- pop() never returns undefined for a non-empty string */ path.split(".").pop() ?? "").toLowerCase(), f.content);
        const desc = LanguageDescription.matchFilename(languages, fileName);
        const lang = desc ? await desc.load() : [];
        if (cancelled || !sourceHost.current) return;
        sourceView.current?.destroy();
        sourceView.current = new EditorView({
          parent: sourceHost.current,
          state: EditorState.create({
            doc: text,
            extensions: [
              lineNumbers(),
              highlightActiveLine(),
              drawSelection(),
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              // Accessible name for the read-only source view's ARIA textbox.
              EditorView.contentAttributes.of({ "aria-label": "Source (read-only)" }),
              // syntax colours follow the per-preview theme (the ◐ toggle)
              syntaxHighlighting(
                previewTheme.peek() === "light" ? defaultHighlightStyle : oneDarkHighlightStyle,
              ),
              lang,
              minimapCompartment.of(makeMinimap()),
            ],
          }),
        });
        if (sourceHost.current) ro.observe(sourceHost.current);
      })
      .catch(() => {
        if (!cancelled) unpreviewable.value = true;
      });
    return () => {
      cancelled = true;
      clearTimeout(resizeT);
      ro.disconnect();
      sourceView.current?.destroy();
      sourceView.current = null;
    };
  }, [path, previewTheme.value]);

  // Rendered reading-view HTML + a mermaid pass after it mounts. Computed here
  // (before the early return) so the effect's hook order stays stable.
  // renderFile picks markdown vs code-block by extension, so a .yml / .json /
  // .toml note renders verbatim (preserving its newlines) instead of being
  // mangled by the markdown parser.
  const readingHtml =
    reading.value && path && !isHtml && !isBinary ? renderFile(path, docText.value).html : "";
  useEffect(() => {
    if (readingHost.current) {
      void renderMermaidIn(readingHost.current).then(() => {
        if (readingHost.current) addMermaidZoomControls(readingHost.current);
      });
      void renderMathIn(readingHost.current);
      // Syntax-highlight + line-number + pretty-print fenced code blocks.
      void enhanceCodeBlocksIn(readingHost.current);
      // Resolve vault image refs to the authed raw endpoint (img can't send the
      // token header, so rawUrl carries it in the query).
      const hideImg = (img: HTMLImageElement) => {
        img.style.display = "none";
      };
      readingHost.current
        .querySelectorAll<HTMLImageElement>("img[data-vault-src],img[data-vault-embed]")
        .forEach((img) => {
          const ref = (/* v8 ignore next -- getAttribute never returns undefined, only null (falling through to the last ?? "") */ img.getAttribute("data-vault-src") ?? img.getAttribute("data-vault-embed") ?? "");
          const path = resolveAsset(ref);
          img.removeAttribute("data-vault-src");
          img.removeAttribute("data-vault-embed");
          if (path) img.src = ctx.daemon.rawUrl(path);
          else hideImg(img); // unresolvable vault ref → hide, don't show a broken icon
        });
      // Hide ANY image that fails to load (a missing vault embed, a broken
      // README asset like `assets/header.png`, a dead external URL) so the
      // reading view shows nothing rather than a broken-image "?" placeholder.
      readingHost.current.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        img.addEventListener("error", () => hideImg(img));
        // Already failed before the listener attached (e.g. cached 404).
        // jsdom can't set img.complete/naturalWidth for a cached-404, so this guard can't fire under test.
        /* v8 ignore start -- jsdom never sets complete=true + naturalWidth=0 for a cached-404 */
        if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) hideImg(img); /* v8 ignore stop */
      });
      // Scroll to a pending [[note#heading]] anchor once the new content is laid out.
      if (pendingHeading.current) {
        const slug = pendingHeading.current;
        pendingHeading.current = null;
        requestAnimationFrame(() => {
          const t = readingHost.current?.querySelector(`#${CSS.escape(slug)}`);
          // jsdom recreates the reading host across note loads, so the anchor is
          // never in *this* element under test — the identical scroll in
          // scrollToHeading() (same-note links) is covered instead.
          /* v8 ignore start -- querySelector never finds the anchor under jsdom (new host on each note load) */
          if (t) (t as HTMLElement).scrollIntoView({ block: "start" }); /* v8 ignore stop */
        });
      }
    }
  }, [readingHtml]);

  // Rich file (xlsx/docx/pptx/drawio) → lazy-load the parser and render read-only
  // HTML into its host (the load effect skipped the text path for these).
  useEffect(() => {
    const el = richHost.current;
    if (!isRich || !path || !el) return;
    let cancelled = false;
    let teardown: (() => void) | void;
    richErr.value = "";
    el.innerHTML = '<div class="rich-msg">Loading preview…</div>';
    void renderRichFile(path, el, ctx.daemon)
      .then((t) => {
        if (cancelled) t?.(); // switched away mid-load — tear it straight back down
        else teardown = t;
      })
      .catch((e) => {
        if (cancelled) return;
        richErr.value = e instanceof Error ? e.message : String(e);
        el.innerHTML = "";
      });
    return () => {
      cancelled = true;
      teardown?.(); // destroy the viewport (window listeners + fullscreen handler)
      el.innerHTML = ""; // drop the rendered content so it can't bleed into the next file
    };
  }, [path, isRich]);

  if (!path) return <div class="ed-empty">Select a note from the Explorer.</div>;

  const onProps = (next: Record<string, unknown>) => {
    props.value = next;
    fm.current = { ...fm.current, obj: next, edited: true };
    saver.current?.schedule();
  };

  // Click a [[wikilink]] in the reading view → open the linked note (event-
  // delegated, like Obsidian — no markdown-link conversion needed).
  const scrollToHeading = (slug: string) => {
    const t = readingHost.current?.querySelector(`#${CSS.escape(slug)}`);
    if (t) (t as HTMLElement).scrollIntoView({ block: "start" });
  };
  const onReadingClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    // Task checkbox → flip the source line through the CodeMirror doc, which drives
    // autosave + the reading re-render. preventDefault stops the uncontrolled toggle
    // (the rendered state comes back from the re-render, not the input itself).
    const cb = el.closest("input.task-check") as HTMLInputElement | null;
    if (cb) {
      e.preventDefault();
      const bodyLine = Number(cb.getAttribute("data-line"));
      const v = view.current;
      if (v && Number.isFinite(bodyLine) && bodyLine >= 0 && bodyLine < v.state.doc.lines) {
        const ln = v.state.doc.line(bodyLine + 1);
        // Allow a blockquote/callout prefix (`> `) and any list marker (-, *, +).
        const m = /^(\s*(?:>\s*)*[-*+]\s+\[)([ xX])(\])/.exec(ln.text);
        // Flip from the SOURCE checkbox char. Only a checkbox line matches, so a
        // (correctly absolute, see renderBody lineBase) data-line can't corrupt a
        // non-task line. Note: don't read cb.checked here — a checkbox's pre-click
        // activation already toggled it, so it reflects the desired state, not the
        // source; the source char (m[2]) is the reliable signal.
        if (m) {
          const pos = ln.from + m[1].length;
          v.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2].toLowerCase() === "x" ? " " : "x" } });
          void saver.current?.flush().then(() => loadTasks(ctx.daemon));
        }
      }
      return;
    }
    const wl = el.closest("[data-wikilink]");
    if (wl) {
      e.preventDefault();
      const note = (/* v8 ignore next -- getAttribute always returns a string (we reached here via closest("[data-wikilink]")) */ wl.getAttribute("data-wikilink") ?? "");
      const heading = wl.getAttribute("data-heading") ?? "";
      if (!note) {
        // a same-note [[#heading]] link — scroll without reopening
        if (heading) scrollToHeading(heading);
        return;
      }
      const target = resolveWikilink(note);
      if (target) {
        pendingHeading.current = heading || null;
        ctx.openFile(target);
      }
      return;
    }
    const tag = el.closest("[data-tag]");
    if (tag) {
      e.preventDefault();
      /* v8 ignore start -- closest("[data-tag]") guarantees getAttribute is non-null */
      openSearch("#" + (tag.getAttribute("data-tag") ?? "")); /* v8 ignore stop */
    }
  };

  // ── Download ────────────────────────────────────────────────────────────────
  const downloadFile = () => {
    // Stream from the daemon with &download=1 so it sends a
    // `Content-Disposition: attachment` carrying the real name — that keeps the
    // original filename + extension even in webviews that ignore the `download`
    // attribute on a blob: URL.
    const a = document.createElement("a");
    a.href = `${ctx.daemon.rawUrl(path)}&download=1`;
    a.download = fileName; // honoured where the attribute already works
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const onSourceWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return; // Cmd/Ctrl-wheel zooms the code font
    e.preventDefault();
    const next = sourceFontScale.value * (e.deltaY < 0 ? 1.1 : 0.9);
    sourceFontScale.value = Math.max(0.6, Math.min(3, next));
  };
  const copySource = () => {
    /* v8 ignore next -- navigator.clipboard is absent in jsdom; sourceView optional-chain fallback unreachable when clipboard is present */
    void navigator.clipboard?.writeText((/* v8 ignore next -- sourceView is always set when copySource is reachable */ sourceView.current?.state.doc.toString() ?? "")).then(() => {
      sourceCopied.value = true;
      setTimeout(() => {
        sourceCopied.value = false;
      }, 1200);
    });
  };

  const segs = path.split("/");
  const fileName = segs[segs.length - 1];
  const dirSegs = segs.slice(0, -1);

  const downloadBtn = (
    <button class="ed-iconbtn" type="button" title="Download file" aria-label="Download" onClick={() => void downloadFile()}>
      <Icon name="download" />
    </button>
  );
  // ◐ background light/dark toggle for the doc/table/code previews.
  const pvThemeBtn = (
    <button
      class="ed-iconbtn"
      type="button"
      title={`Background: ${previewTheme.value} — click to flip`}
      aria-label="Toggle preview background light / dark"
      onClick={() => {
        previewTheme.value = previewTheme.value === "light" ? "dark" : "light";
      }}
    >
      <Icon name="contrast" />
    </button>
  );
  return (
    <div class="ed-wrap">
      <div class="ed-toolbar">
        <div class="ed-nav">
          <button
            class="ed-iconbtn"
            type="button"
            title="Back"
            aria-label="Back"
            disabled={!canNavBack.value}
            onClick={navBack}
          >
            <Icon name="arrow-left" />
          </button>
          <button
            class="ed-iconbtn"
            type="button"
            title="Forward"
            aria-label="Forward"
            disabled={!canNavForward.value}
            onClick={navForward}
          >
            <Icon name="arrow-right" />
          </button>
        </div>
        <div class="ed-crumb" title={path}>
          <Icon name={isImage ? "image" : isHtml ? "code" : "file"} />
          {dirSegs.map((s) => (
            <span class="ed-crumb-dir" key={s}>{s}<span class="ed-crumb-sep">›</span></span>
          ))}
          <span class="ed-crumb-cur">{fileName}</span>
        </div>
        <div class="ed-acts">
          {isImage ? (
            <>
              <span class="ed-badge"><Icon name="image" />{isSvg ? "SVG" : "Image"}</span>
              {downloadBtn}
            </>
          ) : isPdf ? (
            <>
              <span class="ed-badge"><Icon name="file" />PDF</span>
              {downloadBtn}
            </>
          ) : isHtml ? (
            <>
              <span class="ed-badge"><Icon name="code" />HTML</span>
              <button
                class={htmlInteractive.value ? "ed-run is-on" : "ed-run"}
                type="button"
                title={htmlInteractive.value ? "Scripts enabled — click to sandbox again" : "Run interactively (enable scripts in a sandboxed frame)"}
                onClick={() => { htmlInteractive.value = !htmlInteractive.value; }}
              >
                <Icon name="play" />
                <span>{htmlInteractive.value ? "Scripts on" : "Run"}</span>
              </button>
              {downloadBtn}
            </>
          ) : isVideo ? (
            <>
              <span class="ed-badge"><Icon name="play" />Video</span>
              {downloadBtn}
            </>
          ) : isAudio ? (
            <>
              <span class="ed-badge"><Icon name="activity" />Audio</span>
              {downloadBtn}
            </>
          ) : isRich ? (
            <>
              <span class="ed-badge"><Icon name="file" />{richLabel(path)}</span>
              {isDocPreview ? pvThemeBtn : null}
              {downloadBtn}
            </>
          ) : isUnpreviewableExt || unpreviewable.value ? (
            <>
              <span class="ed-badge"><Icon name="file" />{ext ? ext.toUpperCase() : "File"}</span>
              {downloadBtn}
            </>
          ) : isSourceText ? (
            <>
              <span class="ed-badge"><Icon name="code" />{ext ? ext.toUpperCase() : "Text"}</span>
              <div class="ed-zoom">
                <button class="ed-iconbtn" type="button" title="Smaller" aria-label="Smaller" onClick={() => { sourceFontScale.value = Math.max(0.6, sourceFontScale.value - 0.1); }}>
                  <Icon name="minus" />
                </button>
                <button class="ed-zoom-pct" type="button" title="Reset zoom" onClick={() => { sourceFontScale.value = 1; }}>
                  {Math.round(sourceFontScale.value * 100)}%
                </button>
                <button class="ed-iconbtn" type="button" title="Larger" aria-label="Larger" onClick={() => { sourceFontScale.value = Math.min(3, sourceFontScale.value + 0.1); }}>
                  <Icon name="plus" />
                </button>
              </div>
              <button
                class="ed-iconbtn"
                type="button"
                title={sourceCopied.value ? "Copied" : "Copy code"}
                aria-label="Copy code"
                onClick={copySource}
              >
                <Icon name={sourceCopied.value ? "check" : "copy"} />
              </button>
              {pvThemeBtn}
              {downloadBtn}
            </>
          ) : (
            <>
              <SaveBadge />
              {downloadBtn}
              {reading.value && (
                <button
                  class="ed-toggle"
                  title={wideView.value ? "Centred column" : "Full width"}
                  aria-label={wideView.value ? "Centred column" : "Full width"}
                  onClick={() => { wideView.value = !wideView.value; }}
                >
                  <Icon name={wideView.value ? "shrink-h" : "expand-h"} />
                  <span>{wideView.value ? "Center" : "Wide"}</span>
                </button>
              )}
              <button
                class="ed-toggle"
                data-testid="ed-reading-toggle"
                onClick={() => { reading.value = !reading.value; }}
              >
                <Icon name={reading.value ? "code" : "book"} />
                <span>{reading.value ? "Edit" : "Read"}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {isSvg || isImage ? (
        <div class="ed-mediawrap" ref={mediaFrameRef} data-testid="ed-image">
          <div class="ed-media-content" ref={mediaContentRef}>
            {isSvg ? (
              <div class="ed-media-svg" dangerouslySetInnerHTML={{ __html: svgHtml.value }} />
            ) : (
              <img class="ed-media-img" src={ctx.daemon.rawUrl(path)} alt={fileName} />
            )}
          </div>
        </div>
      ) : isPdf ? (
        // No sandbox: the browser's PDF viewer needs same-origin and won't render
        // inside an opaque-origin sandboxed iframe (verified — it shows a broken-page
        // icon). Embedded PDF JavaScript isn't a practical token-theft vector here —
        // Chrome's PDFium disables PDF JS, and Firefox's pdf.js runs it in its own
        // isolated sandbox with no DOM access.
        <iframe
          class="ed-pdf"
          data-testid="ed-pdf"
          src={ctx.daemon.rawUrl(path)}
          title="PDF preview"
          // The token rides in rawUrl's query string; no-referrer stops it leaking
          // via the Referer header if the PDF references any external resource.
          referrerpolicy="no-referrer"
        />
      ) : isHtml ? (
        <iframe
          // re-key on the toggle so flipping it reloads the frame — changing the
          // sandbox attribute alone doesn't re-run the document's scripts.
          key={`html-${path}-${htmlInteractive.value ? "run" : "static"}`}
          class="ed-frame"
          data-testid="ed-html-frame"
          // sandbox="" disables scripts (vault .html is untrusted — imported /
          // AI-generated / synced). The "Run" toggle opts INTO allow-scripts, still
          // WITHOUT allow-same-origin: the frame stays an opaque origin that can't
          // reach the parent, cookies, or the vault.
          sandbox={htmlInteractive.value ? "allow-scripts" : ""}
          srcdoc={docText.value}
          title="HTML preview"
        />
      ) : isVideo ? (
        <div class="ed-mediafile">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video key={path} class="ed-video" controls autoplay={mediaAutoplay.value} src={ctx.daemon.rawUrl(path)} />
        </div>
      ) : isAudio ? (
        <div class="ed-mediafile">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio key={path} class="ed-audio" controls autoplay={mediaAutoplay.value} src={ctx.daemon.rawUrl(path)} />
        </div>
      ) : isRich ? (
        <div
          class="ed-richwrap"
          data-testid="ed-rich"
          data-pv-theme={isDocPreview ? previewTheme.value : undefined}
          style={isDocPreview ? pvAccentStyle : undefined}
        >
          {richErr.value ? (
            <div class="rich-msg rich-err">Couldn’t render this file: {richErr.value}</div>
          ) : null}
          <div class="ed-rich" ref={richHost} />
        </div>
      ) : isUnpreviewableExt || unpreviewable.value ? (
        <div class="ed-unpreview" data-testid="ed-unpreview">
          <Icon name="file" />
          <div class="ed-unpreview-name">{fileName}</div>
          <button class="ed-unpreview-btn" type="button" onClick={() => downloadFile()}>
            <Icon name="download" />
            <span>Download</span>
          </button>
        </div>
      ) : isSourceText ? (
        <div
          class="ed ed-source"
          ref={sourceHost}
          data-testid="ed-source"
          data-pv-theme={previewTheme.value}
          style={`--src-fs:${(13 * sourceFontScale.value).toFixed(1)}px;${pvAccentStyle}`}
          onWheel={onSourceWheel}
        />
      ) : (
        <>
          <Properties value={props.value} onChange={onProps} />
          {reading.value && (
            <div
              class={wideView.value ? "ed-reading is-wide" : "ed-reading"}
              data-testid="ed-reading"
              ref={readingHost}
              onClick={onReadingClick}
              dangerouslySetInnerHTML={{ __html: readingHtml }}
            />
          )}
          <div class={reading.value ? "ed ed-hidden" : "ed"} ref={host} />
        </>
      )}
    </div>
  );
}

export const editorPanel: PanelDef = {
  type: "editor",
  name: "Editor",
  width: 640,
  seed: false,
  Component: Editor,
};
