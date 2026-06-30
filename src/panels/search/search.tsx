// qmd Search panel — real hybrid vault search backed by the qmd index via the
// daemon's `GET /api/vault/search`. Two-tier progressive: a fast BM25 keyword
// pass (mode=lex) fills results as you type, then a semantic pass (mode=hybrid —
// keyword + vector, qmd-ranked) replaces them a beat later. Each keystroke
// aborts the previous in-flight queries so only the latest wins. Clicking a hit
// opens it in Preview. (Replaces the old client-side filename/path substring
// match — the daemon now has a real search endpoint.)

import { useRef, useEffect, useState, useMemo } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { allFiles, vaultTree, vaultError, previewPath } from "../bus";
import { searchQuery } from "../../core/stores";
import type { SearchHit } from "../../core/daemon";
import "./search.css";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// qmd stores SLUGGED paths (each segment lowercased, runs of non-alphanumeric →
// "-", trimmed), so a hit's path won't match the real vault filename (e.g.
// "OMA WS1b — OneLake Security Q&A.md" → "oma-ws1b-onelake-security-q-a.md").
// We rebuild the same slug from each real tree path and map it back, so a hit
// opens the real note. (Matches ~99% of the index; the rare miss — a non-ASCII
// filename qmd transliterates differently — falls back to the raw qmd path.)
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function slugifyPath(realPath: string): string {
  const segs = realPath.split("/");
  const file = segs.pop() ?? "";
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  return [...segs.map(slugify), slugify(stem) + ext].join("/");
}

/** Wrap the query terms in `text` with `<mark>`, WITHOUT innerHTML — each
 *  segment is a Preact node, so there's no HTML-injection surface. Terms shorter
 *  than 2 chars are skipped (too noisy). */
function highlight(text: string, query: string): (string | preact.JSX.Element)[] {
  const terms = query.trim().split(/\s+/).filter((t) => t.length >= 2);
  if (!terms.length || !text) return [text];
  const re = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "ig");
  const want = new Set(terms.map((t) => t.toLowerCase()));
  return text.split(re).map((part, i) => (want.has(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part));
}

/** Client-side fallback for when qmd is unavailable (no `qmd_collection`, qmd not
 *  installed, or the endpoint errored): the old filename/path substring match over
 *  the loaded tree. Returns REAL, openable paths — so no slug resolution needed. */
function searchVault(q: string, files: string[]): SearchHit[] {
  const term = q.toLowerCase();
  const out: SearchHit[] = [];
  for (const path of files) {
    const name = path.split("/").pop() ?? path;
    const lpath = path.toLowerCase();
    const nameIdx = name.toLowerCase().indexOf(term);
    const pathIdx = lpath.indexOf(term);
    if (nameIdx < 0 && pathIdx < 0) continue;
    let score = 0.55;
    if (nameIdx >= 0) score += 0.3;
    if (pathIdx >= 0) score += Math.min(0.3, (lpath.split(term).length - 1) * 0.1);
    out.push({ path, score: Math.min(0.99, score), title: name, snippet: "" });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 20);
}

/** Which tier produced the currently-shown hits ("offline" = the client-side fallback). */
type Tier = "keyword" | "semantic" | "offline" | null;

function Search({ ctx }: { ctx: PanelContext }) {
  // Module-level signal so a #tag click in the reading view can pre-fill the box.
  const query = searchQuery;
  const q = query.value.trim();

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState<Tier>(null);
  const [errMsg, setErrMsg] = useState("");
  // Once a search hits "qmd unavailable" (503 / network), drop to the client-side
  // fallback for the rest of the session instead of re-hammering the endpoint.
  // The ref drives the effect's early-return so flipping it doesn't re-run the
  // effect (which would double-search); the state only drives the empty-state label.
  const [qmdOff, setQmdOff] = useState(false);
  const qmdOffRef = useRef(false);

  // Focus the search box the moment the panel opens, so you can type straight away.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const active = previewPath.value;
  const ready = vaultTree.value !== null;
  const total = allFiles().length;

  // Map qmd's slugged paths back to real, openable vault paths (rebuilt when the
  // tree changes). See slugifyPath above.
  const realBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allFiles()) m.set(slugifyPath(p), p);
    return m;
  }, [vaultTree.value]);

  // Two-tier progressive search. Debounce the query, run lex (fast — shown
  // first), then hybrid (semantic — replaces the list). The cleanup aborts the
  // in-flight requests + clears the timer so every keystroke supersedes the last.
  useEffect(() => {
    if (!q) {
      setHits([]);
      setTier(null);
      setLoading(false);
      setErrMsg("");
      return;
    }
    // qmd already known unavailable → client-side filename/path match, instantly.
    if (qmdOffRef.current) {
      setHits(searchVault(q, allFiles()));
      setTier("offline");
      setLoading(false);
      setErrMsg("");
      return;
    }
    const ac = new AbortController();
    let live = true;
    setLoading(true);
    setErrMsg("");
    const timer = window.setTimeout(async () => {
      // tier 1 — BM25 keyword (no LLM, fast)
      try {
        const lex = await ctx.daemon.search(q, "lex", ac.signal);
        if (!live) return;
        setHits(lex);
        setTier("keyword");
      } catch (e) {
        if (!live || ac.signal.aborted) return;
        // qmd is unavailable (not configured/installed, or it errored) → fall back
        // to the client-side filename/path search so search keeps working.
        qmdOffRef.current = true;
        setQmdOff(true);
        setHits(searchVault(q, allFiles()));
        setTier("offline");
        setLoading(false);
        return;
      }
      // tier 2 — hybrid keyword + semantic (replaces the keyword list)
      try {
        const hyb = await ctx.daemon.search(q, "hybrid", ac.signal);
        if (!live) return;
        setHits(hyb);
        setTier("semantic");
      } catch {
        // Semantic failed or was cancelled — keep the keyword results silently.
      } finally {
        if (live) setLoading(false);
      }
    }, 250);
    return () => {
      live = false;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [q]);

  // Status line above the results: live progress, then the final tier + count.
  let status: preact.JSX.Element | null = null;
  if (errMsg) {
    status = <div class="qs-status qs-err">⚠ {errMsg}</div>;
  } else if (loading) {
    status = (
      <div class="qs-status">
        <span class="qs-spin" /> searching…
      </div>
    );
  } else if (tier && hits.length) {
    const label =
      tier === "semantic" ? "keyword + semantic" : tier === "offline" ? "filename match" : "keyword";
    status = (
      <div class="qs-status">
        {label} · {hits.length} result{hits.length === 1 ? "" : "s"}
      </div>
    );
  }

  // Results body.
  let body: preact.JSX.Element | null;
  if (!q) {
    body = (
      <div class="qs-empty">
        {ready ? (
          <>
            Type to search the vault
            <br />
            {qmdOff ? "filename match" : "keyword + semantic"} · {total.toLocaleString()} notes
          </>
        ) : vaultError.value ? (
          <>⚠ {vaultError.value}</>
        ) : (
          "loading vault…"
        )}
      </div>
    );
  } else if (hits.length) {
    body = (
      <>
        {hits.map((h) => {
          const real = realBySlug.get(h.path) ?? h.path;
          const name = h.title || real.split("/").pop() || real;
          const dir = real.split("/").slice(0, -1).join("/") || "root";
          return (
            <div key={h.path} class={`qs-hit${real === active ? " active" : ""}`} onClick={() => ctx.openFile(real)}>
              <div class="qh-top">
                <span class="qh-name">{name}</span>
                <span class="qh-score">{h.score.toFixed(2)}</span>
              </div>
              <div class="qh-path">{dir}</div>
              {h.snippet && <div class="qh-snip">{highlight(h.snippet, q)}</div>}
            </div>
          );
        })}
      </>
    );
  } else if (loading) {
    body = null; // the status line shows "searching…"
  } else {
    body = (
      <div class="qs-empty">
        No matches for "{q}"
        <br />
        try a broader term
      </div>
    );
  }

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          qmd · Search
        </span>
        <span class="w-meta">LEX+VEC</span>
      </div>
      <div class="qs-box">
        <svg class="qs-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          class="qs-in"
          type="text"
          placeholder="search the vault…"
          autocomplete="off"
          spellcheck={false}
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
        {query.value && (
          <button
            class="qs-clear"
            type="button"
            title="Clear"
            aria-label="Clear search"
            onClick={(e) => {
              query.value = "";
              (e.currentTarget.closest(".qs-box")?.querySelector("input") as HTMLInputElement | null)?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
      <div class="qs-results">
        {status}
        {body}
      </div>
    </>
  );
}

export const searchPanel: PanelDef = {
  type: "search",
  name: "qmd Search",
  width: 360,
  seed: false, // not seeded on first load; opened on demand
  Component: Search,
};
