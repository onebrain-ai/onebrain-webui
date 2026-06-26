import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
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
import { renderMermaidIn } from "../../core/mermaid";
import { renderMathIn } from "../../core/katex";
import { Icon } from "../../ui/Icon";
import "./editor.css";

/**
 * The run-function wired to the Mod-s keybinding.
 * Exported so tests can invoke it directly (jsdom does not propagate key events
 * through CodeMirror's event handler chain, so fireEvent.keyDown cannot reach it).
 * In production this is called by CodeMirror; the `sv` closure is set per-load.
 */
export let _cmdSaveRun: (() => boolean) | null = null;

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

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

/** The SVG's intrinsic width (viewBox width, else the width attribute) — the base
 *  for pixel-zoom. Defaults to 800 when neither is present. */
function svgIntrinsicWidth(s: string): number {
  const vb = s.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)/i);
  if (vb) return parseFloat(vb[1]) || 800;
  const w = s.match(/\bwidth\s*=\s*["']?\s*([\d.]+)/i);
  if (w) return parseFloat(w[1]) || 800;
  return 800;
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
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const richHost = useRef<HTMLDivElement>(null);
  const richErr = useSignal("");
  const mediaW = useRef<number>(0); // intrinsic width of the current image/svg
  const view = useRef<EditorView | null>(null);
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
  // Object URL for a raster-image / PDF preview (created from the raw-bytes blob).
  const blobUrl = useSignal("");
  // Sanitized markup for an inline SVG preview (rendered into the DOM, NOT via an
  // <img>, so it can use the page's web fonts — an <img>-embedded SVG cannot).
  const svgHtml = useSignal("");
  // Image zoom: `fit` = scale to the pane; otherwise a numeric factor of intrinsic.
  const imgFit = useSignal(true);
  const imgZoom = useSignal(1);

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

  useEffect(() => {
    if (!path) return;
    // Each note starts clean — clear any prior note's save/conflict state so a
    // stale toast/indicator can't carry over to a different note.
    saveStatus.value = "idle";
    dirty.value = false;
    conflictRev.value = null;
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
      imgFit.value = true; // every new image opens fit-to-pane
      imgZoom.value = 1;
      mediaW.current = 0;

      if (isSvg) {
        // Inline the SVG so it renders with the page's fonts (Chakra Petch / etc).
        svgHtml.value = "";
        void ctx.daemon.file(path).then((f) => {
          if (cancelled) return;
          svgHtml.value = sanitizeSvg(f.content);
          mediaW.current = svgIntrinsicWidth(f.content);
        });
        return () => {
          cancelled = true;
          editorBridge.value = null;
        };
      }

      // Raster image / PDF → object URL from the raw bytes (revoked on cleanup).
      blobUrl.value = "";
      let url: string | null = null;
      void ctx.daemon.fileBlob(path).then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        blobUrl.value = url;
      });
      return () => {
        cancelled = true;
        editorBridge.value = null;
        if (url) URL.revokeObjectURL(url);
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
    });
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
      editorBridge.value = null;
      _cmdSaveRun = null;
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
      void renderMermaidIn(readingHost.current);
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
    richErr.value = "";
    el.innerHTML = '<div class="rich-msg">Loading preview…</div>';
    void renderRichFile(path, el, ctx.daemon).catch((e) => {
      if (cancelled) return;
      richErr.value = e instanceof Error ? e.message : String(e);
      el.innerHTML = "";
    });
    return () => {
      cancelled = true;
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

  // ── Image zoom + download ──────────────────────────────────────────────────
  const zoomBy = (mult: number) => {
    if (imgFit.value) {
      // Continue smoothly from the current fitted scale.
      const el = isSvg ? svgRef.current?.querySelector("svg") : imgRef.current;
      const base = mediaW.current || 1;
      const cur = el ? (el as Element).getBoundingClientRect().width / base : 1;
      imgFit.value = false;
      imgZoom.value = clampZoom(cur * mult);
    } else {
      imgZoom.value = clampZoom(imgZoom.value * mult);
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 0.87);
    }
  };
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
  const zoomedStyle = imgFit.value
    ? ""
    : `width:${Math.round((mediaW.current || 800) * imgZoom.value)}px;max-width:none;max-height:none;height:auto`;

  const downloadBtn = (
    <button class="ed-iconbtn" type="button" title="Download file" aria-label="Download" onClick={() => void downloadFile()}>
      <Icon name="download" />
    </button>
  );
  const zoomControls = (
    <div class="ed-zoom">
      <button class="ed-iconbtn" type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
        <Icon name="minus" />
      </button>
      <button class="ed-zoom-pct" type="button" title="Fit to pane" onClick={() => { imgFit.value = true; }}>
        {imgFit.value ? "Fit" : `${Math.round(imgZoom.value * 100)}%`}
      </button>
      <button class="ed-iconbtn" type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
        <Icon name="plus" />
      </button>
      <button class="ed-iconbtn" type="button" title="Fit to pane" aria-label="Fit" onClick={() => { imgFit.value = true; }}>
        <Icon name="maximize" />
      </button>
    </div>
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
              {zoomControls}
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
          ) : (
            <>
              <SaveBadge />
              {downloadBtn}
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

      {isSvg ? (
        <div class="ed-binwrap" data-testid="ed-image" onWheel={onWheel}>
          <div
            class={imgFit.value ? "ed-media ed-svg" : "ed-media ed-svg zoomed"}
            ref={svgRef}
            style={zoomedStyle}
            dangerouslySetInnerHTML={{ __html: svgHtml.value }}
          />
        </div>
      ) : isImage ? (
        <div class="ed-binwrap" data-testid="ed-image" onWheel={onWheel}>
          {blobUrl.value && (
            <img
              class="ed-media ed-img"
              ref={imgRef}
              src={blobUrl.value}
              alt={fileName}
              style={zoomedStyle}
              onLoad={(e) => { mediaW.current = (e.target as HTMLImageElement).naturalWidth || 0; }}
            />
          )}
        </div>
      ) : isPdf ? (
        blobUrl.value ? (
          <iframe class="ed-pdf" data-testid="ed-pdf" src={blobUrl.value} title="PDF preview" />
        ) : (
          <div class="ed-binwrap" />
        )
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
      ) : (
        <>
          <Properties value={props.value} onChange={onProps} />
          {reading.value && (
            <div
              class="ed-reading"
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
