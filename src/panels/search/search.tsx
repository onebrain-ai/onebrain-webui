// qmd Search panel — vault search wired to the REAL file list (the daemon has no
// search endpoint, so we match over the loaded tree's names + paths, like the
// Explorer's filter, rather than the prototype's in-memory body mock). Keeps the
// prototype's visuals (name · score · path · highlighted snippet); clicking a hit
// opens it in Preview. Ported from the prototype (template 1266–1270, buildSearch
// 2889–2907, OB.search 2705–2719).

import { useSignal } from "@preact/signals";
import type { PanelDef, PanelContext } from "../contract";
import { allFiles, vaultTree, vaultError, previewPath } from "../bus";
import "./search.css";

interface Hit {
  path: string;
  name: string;
  dir: string;
  score: number;
  snippet: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Match `q` against vault file names + paths; score name hits highest, build a
 *  highlighted path snippet. Returns the top 8, best first. */
function searchVault(q: string): Hit[] {
  const term = q.toLowerCase();
  const out: Hit[] = [];
  for (const path of allFiles()) {
    const name = path.split("/").pop() ?? path;
    const lpath = path.toLowerCase();
    const nameIdx = name.toLowerCase().indexOf(term);
    const pathIdx = lpath.indexOf(term);
    if (nameIdx < 0 && pathIdx < 0) continue;

    let score = 0.55;
    if (nameIdx >= 0) score += 0.3;
    if (pathIdx >= 0) {
      const count = lpath.split(term).length - 1;
      score += Math.min(0.3, count * 0.1);
    }

    // highlight the first match within the path so the user sees where it hit
    const hi = pathIdx >= 0 ? pathIdx : Math.max(0, lpath.indexOf(name.toLowerCase()) + nameIdx);
    const from = Math.max(0, hi - 22);
    const snippet =
      (from > 0 ? "…" : "") +
      esc(path.slice(from, hi)) +
      "<mark>" +
      esc(path.slice(hi, hi + term.length)) +
      "</mark>" +
      esc(path.slice(hi + term.length, hi + term.length + 46));

    out.push({
      path,
      name,
      dir: path.split("/").slice(0, -1).join("/") || "root",
      score: Math.min(0.99, score),
      snippet,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

function Search({ ctx }: { ctx: PanelContext }) {
  const query = useSignal("");
  const active = previewPath.value;
  // subscribe to the tree so the panel re-renders (and search works) once the
  // vault finishes loading
  const ready = vaultTree.value !== null;
  const total = allFiles().length;
  const q = query.value.trim().toLowerCase();
  const hits = q ? searchVault(q) : [];

  let body: preact.JSX.Element;
  if (!q) {
    body = (
      <div
        class="qs-empty"
        dangerouslySetInnerHTML={{
          __html: ready
            ? `พิมพ์เพื่อค้นทั่ว vault<br>lex + vec + hyde · ${total.toLocaleString()} notes`
            : vaultError.value
              ? `⚠ ${esc(vaultError.value)}`
              : "loading vault…",
        }}
      />
    );
  } else if (!hits.length) {
    body = (
      <div class="qs-empty" dangerouslySetInnerHTML={{ __html: `No matches for "${esc(q)}"<br>try a broader term` }} />
    );
  } else {
    body = (
      <>
        {hits.map((h) => (
          <div class={`qs-hit${h.path === active ? " active" : ""}`} onClick={() => ctx.openFile(h.path)}>
            <div class="qh-top">
              <span class="qh-name">{h.name}</span>
              <span class="qh-score">{h.score.toFixed(2)}</span>
            </div>
            <div class="qh-path">{h.dir}</div>
            <div class="qh-snip" dangerouslySetInnerHTML={{ __html: h.snippet }} />
          </div>
        ))}
      </>
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
          class="qs-in"
          type="text"
          placeholder="search the vault…"
          autocomplete="off"
          spellcheck={false}
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="qs-results">{body}</div>
    </>
  );
}

export const searchPanel: PanelDef = {
  type: "search",
  name: "qmd Search",
  width: 360,
  placement: { t: -0.64, y: 1.55, r: 7.0, s: 0.005 },
  seed: false, // not in the SEED arc; spawn via add-panel / ⌘K
  Component: Search,
};
