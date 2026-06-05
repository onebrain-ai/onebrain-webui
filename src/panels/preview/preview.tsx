// File Preview panel — renders the vault file `previewPath` points at, fetched
// live from the daemon. Ported from the prototype (template 1248–1252,
// renderPreview 2767–2780). Markdown (frontmatter + body), YAML (pre), HTML
// (sandboxed iframe), image (placeholder). Wikilinks open in-place (cross-panel).

import { useSignal, computed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { renderMarkdown } from "../../core/markdown";
import { previewPath, resolveWikilink, openFile } from "../bus";
import "./preview.css";

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"];

/** Parse the raw YAML frontmatter into display pairs. Shows every top-level key
 *  (like the prototype's pre-parsed `f.fm`), collapsing block lists
 *  (`tags:\n  - a\n  - b`) and inline arrays (`[a, b]`) to a comma-joined value. */
function parseFrontmatter(fm: string): { key: string; value: string }[] {
  const lines = fm.split("\n");
  const out: { key: string; value: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]); // top-level key (no leading indent)
    if (!m || /^\s/.test(lines[i])) continue;
    let value = m[2].trim();
    if (!value) {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+-\s+/, "").trim());
      }
      value = items.join(", ");
    } else {
      value = value.replace(/^\[(.*)]$/, "$1"); // inline [a, b] → a, b
    }
    out.push({ key: m[1], value });
  }
  return out;
}

function frontmatterBlock(fm: string | null) {
  if (!fm) return null;
  const rows = parseFrontmatter(fm);
  if (!rows.length) return null;
  return (
    <div class="pv-fm">
      {rows.map((r) => (
        <div>
          <span class="fk">{r.key}:</span> <span class="fv">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** the current preview file's extension (uppercased) for a header meta, or "—".
 *  A computed so the subscription is explicit + component-boundary-independent. */
export const previewExt = computed(() => {
  const path = previewPath.value;
  if (!path) return "—";
  return (path.split(".").pop() ?? "").toUpperCase();
});

/** The path line + rendered file body — the reusable preview body (no panel
 *  header), shared by the standalone Preview panel and the combined File Browser. */
export function PreviewBody({ ctx }: { ctx: PanelContext }) {
  const path = previewPath.value;
  const data = useSignal<{ content: string | null; error: string | null; loading: boolean }>({
    content: null,
    error: null,
    loading: false,
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  const ext = path ? (path.split(".").pop() ?? "").toLowerCase() : "";
  const isImg = IMG_EXT.includes(ext);
  const isHtml = ext === "html" || ext === "htm";
  const isYml = ext === "yml" || ext === "yaml";

  // fetch the file when the path changes (images aren't fetched — binary)
  useEffect(() => {
    if (!path || isImg) return;
    let cancelled = false;
    data.value = { content: null, error: null, loading: true };
    ctx.daemon
      .file(path)
      .then((f) => {
        if (!cancelled) data.value = { content: f.content, error: null, loading: false };
      })
      .catch((e: unknown) => {
        if (!cancelled) data.value = { content: null, error: e instanceof Error ? e.message : String(e), loading: false };
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // wikilink clicks (event-delegated on the static .pv-body) open the linked
  // note in-place. Delegation means the listener is bound once and survives
  // content swaps — no need to re-attach when the body HTML changes.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("[data-wikilink]");
      if (!a) return;
      e.preventDefault();
      const target = resolveWikilink(a.getAttribute("data-wikilink") ?? "");
      if (target) openFile(target);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  let body: preact.JSX.Element;
  if (!path) {
    body = <div class="pv-empty">Select a file from the Explorer to preview.</div>;
  } else if (isImg) {
    const name = path.split("/").pop() ?? path;
    body = (
      <div class="pv-img">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <circle cx="8.5" cy="8.5" r="1.8" />
          <path d="M21 16l-5-5L5 21" />
        </svg>
        {name}
        <br />
        image preview · {ext.toUpperCase()}
      </div>
    );
  } else if (data.value.loading) {
    body = <div class="pv-empty">Loading…</div>;
  } else if (data.value.error) {
    body = <div class="pv-empty">{data.value.error}</div>;
  } else if (isHtml) {
    body = <iframe class="pv-frame" sandbox="" srcdoc={data.value.content ?? ""} />;
  } else if (isYml) {
    body = (
      <pre>
        <code>{data.value.content}</code>
      </pre>
    );
  } else {
    const parsed = renderMarkdown(data.value.content ?? "");
    body = (
      <>
        {frontmatterBlock(parsed.frontmatter)}
        <div dangerouslySetInnerHTML={{ __html: parsed.html }} />
      </>
    );
  }

  return (
    <>
      <div class="pv-path">{path || "no file open"}</div>
      <div class="pv-body" ref={bodyRef}>
        {body}
      </div>
    </>
  );
}

function Preview({ ctx }: { ctx: PanelContext }) {
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Preview
        </span>
        <span class="w-meta pv-meta">{previewExt.value}</span>
      </div>
      <PreviewBody ctx={ctx} />
    </>
  );
}

export const previewPanel: PanelDef = {
  type: "preview",
  name: "File Preview",
  width: 446,
  placement: { t: 0.0, y: 0.24, r: 5.7, s: 0.005 },
  seed: false, // folded into the combined File Browser; still spawnable standalone
  Component: Preview,
};
