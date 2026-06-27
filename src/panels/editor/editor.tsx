import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, LanguageDescription } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { showMinimap } from "@replit/codemirror-minimap";
import { languages } from "@codemirror/language-data";
import type { PanelDef, PanelContext } from "../contract";
import { previewPath, resolveWikilink, resolveAsset, navBack, navForward, canNavBack, canNavForward } from "../bus";
import { openSearch } from "../../core/stores";
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
import { Icon } from "../../ui/Icon";
import "./editor.css";

/** Binary file types with no in-app preview — shown as an icon + Download button
 *  instead of being force-loaded as text (which would fail / show garbage). Any
 *  other non-UTF-8 file is caught at load time and falls back the same way. */
const UNPREVIEWABLE_EXT = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
  "exe", "dmg", "app", "pkg", "deb", "rpm", "msi", "bin", "iso", "wasm",
  "mp4", "mov", "avi", "mkv", "webm", "m4v",
  "mp3", "wav", "flac", "ogg", "m4a", "aac",
  "woff", "woff2", "ttf", "otf", "eot",
  "psd", "ai", "sketch", "fig", "xd", "eps",
  "blend", "obj", "stl", "fbx", "glb", "gltf",
  "db", "sqlite", "sqlite3", "dat", "pyc", "class", "so", "dll", "dylib", "parquet",
]);

/** Pretty-print structured text before it's shown (the view is read-only, so the
 *  file itself is never changed). Malformed input is returned unchanged — better a
 *  raw view than an error. */
async function formatStructured(path: string, text: string): Promise<string> {
  const e = (path.split(".").pop() ?? "").toLowerCase();
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

/** Indent an XML document for the read-only preview; unchanged on a parse error. */
function formatXml(xml: string): string {
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

/**
 * The run-function wired to the Mod-s keybinding.
 * Exported so tests can invoke it directly (jsdom does not propagate key events
 * through CodeMirror's event handler chain, so fireEvent.keyDown cannot reach it).
 * In production this is called by CodeMirror; the `sv` closure is set per-load.
 */
export let _cmdSaveRun: (() => boolean) | null = null;

/** Clean an inline SVG before it's injected into the *page* DOM (it renders
 *  inline, not in a sandboxed iframe, so page fonts apply — which means it MUST
 *  be sanitized properly, not by regex). Vault files are treated as untrusted
 *  (imported / AI-generated / synced), so we parse the SVG and drop:
 *   - active/foreign elements (<script>, <foreignObject>, <animate*>, <set>, <handler>)
 *   - every on* event-handler attribute (quoted OR unquoted)
 *   - any href / xlink:href whose scheme isn't a safe `#`, http(s), or data:image
 *   - inline style with url()/expression()/javascript:
 *  Returns "" on a parse error so a malformed/hostile file renders nothing. */
const SVG_BAD_EL = new Set(["script", "foreignobject", "animate", "animatetransform", "animatemotion", "set", "handler"]);
function sanitizeSvg(s: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(s, "image/svg+xml");
  } catch {
    return "";
  }
  if (doc.querySelector("parsererror")) return "";
  const svg = doc.querySelector("svg");
  if (!svg) return "";
  const clean = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (SVG_BAD_EL.has(child.tagName.toLowerCase())) child.remove();
      else clean(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if (name === "href" || name === "xlink:href") {
        if (!/^(#|https?:|data:image\/)/i.test(attr.value.trim())) el.removeAttribute(attr.name);
      } else if (name === "style" && /url\s*\(|expression|javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  };
  clean(svg);
  return new XMLSerializer().serializeToString(svg);
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
  return <span class={`ed-save st-${state}`}>{view[state] ?? null}</span>;
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

  const path = previewPath.value;
  const ext = path ? (path.split(".").pop() ?? "").toLowerCase() : "";
  // Non-text files preview read-only — no CodeMirror, no autosave, no frontmatter.
  const isHtml = ext === "html" || ext === "htm";
  const isSvg = ext === "svg";
  const isImage = isSvg || ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"].includes(ext);
  const isPdf = ext === "pdf";
  const isBinary = isImage || isPdf;
  // Rich (Office / drawio) files preview read-only via richfile.ts, like binaries.
  const isRich = isRichFile(path ?? "");
  // Known-binary extension → never attempt a text preview (icon + Download instead).
  const isUnpreviewableExt = UNPREVIEWABLE_EXT.has(ext);
  const isMarkdown = ext === "md" || ext === "markdown";
  // Any other text file (source / config / data) → read-only syntax view with line
  // numbers + minimap. Binaries that slip through fall back via the load-time catch.
  const isSourceText = !isMarkdown && !isBinary && !isHtml && !isRich && !isUnpreviewableExt;

  useEffect(() => {
    if (!path) return;
    // Each note starts clean — clear any prior note's save/conflict state so a
    // stale toast/indicator can't carry over to a different note.
    saveStatus.value = "idle";
    dirty.value = false;
    conflictRev.value = null;
    unpreviewable.value = false;
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
        compose: () => compose(fm.current, view.current?.state.doc.toString() ?? ""),
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
              if (u.docChanged) {
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
        if (!myView) return;
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
    void ctx.daemon
      .file(path)
      .then(async (f) => {
        if (cancelled || !sourceHost.current) return;
        const text = await formatStructured(path, f.content);
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
              syntaxHighlighting(oneDarkHighlightStyle),
              lang,
              showMinimap.of({
                create: () => ({ dom: document.createElement("div") }),
                displayText: "blocks",
                showOverlay: "always",
              }),
            ],
          }),
        });
      })
      .catch(() => {
        if (!cancelled) unpreviewable.value = true;
      });
    return () => {
      cancelled = true;
      sourceView.current?.destroy();
      sourceView.current = null;
    };
  }, [path]);

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
      // Resolve vault image refs to the authed raw endpoint (img can't send the
      // token header, so rawUrl carries it in the query).
      const hideImg = (img: HTMLImageElement) => {
        img.style.display = "none";
      };
      readingHost.current
        .querySelectorAll<HTMLImageElement>("img[data-vault-src],img[data-vault-embed]")
        .forEach((img) => {
          const ref = img.getAttribute("data-vault-src") ?? img.getAttribute("data-vault-embed") ?? "";
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
        if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) hideImg(img);
      });
      // Scroll to a pending [[note#heading]] anchor once the new content is laid out.
      if (pendingHeading.current) {
        const slug = pendingHeading.current;
        pendingHeading.current = null;
        requestAnimationFrame(() => {
          const t = readingHost.current?.querySelector(`#${CSS.escape(slug)}`);
          if (t) (t as HTMLElement).scrollIntoView({ block: "start" });
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
      const note = wl.getAttribute("data-wikilink") ?? "";
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
      openSearch("#" + (tag.getAttribute("data-tag") ?? ""));
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

  const segs = path.split("/");
  const fileName = segs[segs.length - 1];
  const dirSegs = segs.slice(0, -1);

  const downloadBtn = (
    <button class="ed-iconbtn" type="button" title="Download file" aria-label="Download" onClick={() => void downloadFile()}>
      <Icon name="download" />
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
              <span class="ed-badge"><Icon name="code" />HTML preview</span>
              {downloadBtn}
            </>
          ) : isRich ? (
            <>
              <span class="ed-badge"><Icon name="file" />{richLabel(path)}</span>
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
        <iframe class="ed-pdf" data-testid="ed-pdf" src={ctx.daemon.rawUrl(path)} title="PDF preview" />
      ) : isHtml ? (
        <iframe
          class="ed-frame"
          data-testid="ed-html-frame"
          // sandbox="" — fully isolated, scripts DISABLED. Vault .html files are
          // untrusted (imported / AI-generated / synced), so the preview renders
          // them as static documents. (Interactive HTML would be a deliberate
          // `allow-scripts` opt-in, never with allow-same-origin.)
          sandbox=""
          srcdoc={docText.value}
          title="HTML preview"
        />
      ) : isRich ? (
        <div class="ed-richwrap" data-testid="ed-rich">
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
        <div class="ed ed-source" ref={sourceHost} data-testid="ed-source" />
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
  placement: { t: 0.0, y: 0.24, r: 5.7, s: 0.005 },
  seed: false,
  Component: Editor,
};
