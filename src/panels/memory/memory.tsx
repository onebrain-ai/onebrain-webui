// Memory Browser panel — lists the agent's memory facts (vault `05-agent/memory/`)
// grouped by type, with a distribution chart, in-folder search, and click-to-open
// (which doubles as the entry point for a memory review). Active facts lead;
// expired / replaced ones are grouped at the bottom. Data is loaded once and
// cached at module scope so switching sidebar tabs doesn't re-fetch.

import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { vaultTree, allFiles, vaultConfig, openFile } from "../bus";
import { splitNote, parseFrontmatter } from "../../core/frontmatter";
import { Icon } from "../../ui/Icon";
import "./memory.css";

interface MemEntry {
  path: string;
  title: string;
  type: string;
  snippet: string;
  topics: string[];
  updated: string;
  status: string;
  active: boolean;
}

const entries = signal<MemEntry[] | null>(null);
const loading = signal(false);
const error = signal<string | null>(null);
// Filter state (persists across tab switches).
const selectedType = signal<string | null>(null);
const query = signal("");

const TYPES = ["behavioral", "dev", "context", "project", "other"] as const;
const TYPE_LABEL: Record<string, string> = {
  behavioral: "Behavioral",
  dev: "Dev",
  context: "Context",
  project: "Project",
  other: "Other",
};
// A fact is "inactive" once its status says it was superseded / aged out.
const INACTIVE_RE = /expir|replac|supersed|archiv|deprecat|stale|retired|obsolete|inactive/;

function memoryPrefix(): string {
  const folders = vaultConfig.value?.folders ?? {};
  const agent = (folders.agent ?? "05-agent").toLowerCase().replace(/\/$/, "");
  return `${agent}/memory/`;
}

function humanize(path: string): string {
  const base = path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function load(ctx: PanelContext): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const prefix = memoryPrefix();
    const paths = allFiles().filter((p) => {
      const lp = p.toLowerCase();
      return lp.startsWith(prefix) && lp.endsWith(".md") && !lp.endsWith("/memory.md");
    });
    const loaded = await Promise.all(
      paths.map(async (path): Promise<MemEntry | null> => {
        try {
          const f = await ctx.daemon.file(path);
          const { raw, body } = splitNote(f.content);
          const fm = parseFrontmatter(raw);
          const meta = (fm.metadata ?? {}) as { type?: unknown };
          const rawType = String(fm.type ?? meta.type ?? "other").toLowerCase();
          const type = (TYPES as readonly string[]).includes(rawType) ? rawType : "other";
          const lines = body.split("\n").map((l) => l.trim());
          const heading = lines.find((l) => /^#\s+/.test(l));
          const title = heading ? heading.replace(/^#\s+/, "") : humanize(path);
          const snippet =
            lines.find((l) => l.length > 0 && !/^#/.test(l) && !l.startsWith("**")) ?? "";
          const status = String(fm.status ?? "").toLowerCase();
          const topics = Array.isArray(fm.topics) ? fm.topics.map((t) => String(t)) : [];
          return {
            path,
            title,
            type,
            snippet: snippet.slice(0, 110),
            topics,
            updated: String(fm.updated ?? fm.created ?? ""),
            status,
            active: !INACTIVE_RE.test(status),
          };
        } catch {
          return null;
        }
      }),
    );
    entries.value = loaded.filter((e): e is MemEntry => e !== null);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

function Item({ e }: { e: MemEntry }) {
  return (
    <button
      class={`mem-item${e.active ? "" : " is-inactive"}`}
      type="button"
      title={e.path}
      onClick={() => openFile(e.path)}
    >
      <span class="mem-item-title">{e.title}</span>
      {e.snippet && <span class="mem-item-snip">{e.snippet}</span>}
    </button>
  );
}

function Memory({ ctx }: { ctx: PanelContext }) {
  const tree = vaultTree.value; // subscribe → (re)load when the vault tree changes
  // Fingerprint the memory-file set so an external add/delete — a focus rescan,
  // /learn, or an edit in Obsidian — reloads the panel, not just the first mount.
  // Gating on `entries === null` alone pinned the very first load forever.
  const memSig =
    tree === null
      ? ""
      : allFiles()
          .filter((p) => {
            const lp = p.toLowerCase();
            return lp.startsWith(memoryPrefix()) && lp.endsWith(".md") && !lp.endsWith("/memory.md");
          })
          .join("|");
  useEffect(() => {
    if (tree !== null && !loading.value) void load(ctx);
  }, [memSig]);

  const list = entries.value;
  const total = (list ?? []).length;
  const active = (list ?? []).filter((e) => e.active);
  const inactive = (list ?? []).filter((e) => !e.active);

  // chart = active counts by type (clickable → filter)
  const counts = TYPES.map((t) => ({ t, n: active.filter((e) => e.type === t).length })).filter(
    (c) => c.n > 0,
  );
  const max = Math.max(1, ...counts.map((c) => c.n));

  const q = query.value.trim().toLowerCase();
  const match = (e: MemEntry) => {
    if (selectedType.value && e.type !== selectedType.value) return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) ||
      e.snippet.toLowerCase().includes(q) ||
      e.topics.some((t) => t.toLowerCase().includes(q))
    );
  };

  const activeShown = active.filter(match);
  const byType = new Map<string, MemEntry[]>(TYPES.map((t) => [t, []]));
  for (const e of activeShown) byType.get(e.type)!.push(e);
  for (const arr of byType.values()) arr.sort((a, b) => b.updated.localeCompare(a.updated));
  const inactiveShown = inactive.filter(match).sort((a, b) => b.updated.localeCompare(a.updated));
  const nothing = activeShown.length === 0 && inactiveShown.length === 0;

  return (
    <>
      <div class="w-head">
        <span class="pill">Memory · Library</span>
        <button
          class="mem-refresh"
          type="button"
          title="Reload memory"
          aria-label="Reload memory"
          onClick={() => {
            entries.value = null;
            void load(ctx);
          }}
        >
          <Icon name="refresh" />
        </button>
        <span class="w-meta">{total} FACTS</span>
      </div>

      {list === null ? (
        <div class="mem-empty">{loading.value ? "Loading memory…" : "—"}</div>
      ) : error.value ? (
        <div class="mem-empty">{error.value}</div>
      ) : total === 0 ? (
        <div class="mem-empty">No memory facts yet.</div>
      ) : (
        <>
          <div class="mem-search-row">
            <Icon name="search" />
            <input
              class="mem-search"
              type="text"
              placeholder="Search memory…"
              value={query.value}
              onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
            />
            {query.value && (
              <button class="mem-search-x" type="button" aria-label="Clear" onClick={() => (query.value = "")}>
                <Icon name="x" />
              </button>
            )}
          </div>

          <div class="mem-chart" aria-label="Active facts by type — click to filter">
            {counts.map((c) => (
              <button
                class={`mem-bar-row${selectedType.value === c.t ? " on" : ""}`}
                type="button"
                key={c.t}
                onClick={() => (selectedType.value = selectedType.value === c.t ? null : c.t)}
              >
                <span class="mem-bar-lab">{TYPE_LABEL[c.t]}</span>
                <span class="mem-bar-track">
                  <span class="mem-bar-fill" style={`width:${Math.round((c.n / max) * 100)}%`} />
                </span>
                <span class="mem-bar-n">{c.n}</span>
              </button>
            ))}
            {selectedType.value && (
              <button class="mem-clear" type="button" onClick={() => (selectedType.value = null)}>
                clear filter
              </button>
            )}
          </div>

          {nothing ? (
            <div class="mem-empty">No matches.</div>
          ) : (
            <div class="mem-list">
              {TYPES.filter((t) => byType.get(t)!.length).map((t) => (
                <div class="mem-group" key={t}>
                  <div class="mem-group-head">
                    <span>{TYPE_LABEL[t]}</span>
                    <span class="mem-group-n">{byType.get(t)!.length}</span>
                  </div>
                  {byType.get(t)!.map((e) => (
                    <Item e={e} key={e.path} />
                  ))}
                </div>
              ))}

              {inactiveShown.length > 0 && (
                <div class="mem-group mem-inactive-group">
                  <div class="mem-group-head">
                    <span>Archived · Replaced</span>
                    <span class="mem-group-n">{inactiveShown.length}</span>
                  </div>
                  {inactiveShown.map((e) => (
                    <Item e={e} key={e.path} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

export const memoryPanel: PanelDef = {
  type: "memory",
  name: "Memory",
  width: 340,
  placement: { t: -1.0, y: 0.6, r: 7.0, s: 0.005 },
  seed: false,
  Component: Memory,
};
