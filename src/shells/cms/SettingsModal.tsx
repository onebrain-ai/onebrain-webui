// Settings modal — opened from the topbar gear. A two-pane operator console: a
// left category rail (tablist) + a content pane. Categories:
//   • Appearance — theme, accent, density (editable, persisted via core/stores)
//   • Preview    — .html script autorun + media autoplay (editable)
//   • Vault      — a READ-ONLY view of the loaded onebrain.yml (the vault file
//                  stays the source of truth; this surface only reflects it)
//   • About      — build version, "What's new" (latest changelog), and links
// A search box filters the editable settings across categories. The active
// category is persisted so the modal reopens where you left off.

import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  ACCENTS,
  accent,
  setAccent,
  density,
  setDensity,
  theme,
  setTheme,
  htmlAutorun,
  setHtmlAutorun,
  mediaAutoplay,
  setMediaAutoplay,
  settingsCategory,
  setSettingsCategory,
  type AccentName,
  type SettingsCat,
} from "../../core/stores";
import { vaultConfig } from "../../panels/bus";
import { renderMarkdown } from "../../core/markdown";
import { fetchChangelog, latestEntry, type ChangelogEntry } from "../../core/changelog";
import { Icon, type IconName } from "../../ui/Icon";
import { trapFocus } from "../../ui/Modal";
import "./settings-modal.css";

// ── Categories (rail order + pane header copy) ───────────────────────────────
const CATEGORIES: { id: SettingsCat; label: string; icon: IconName; desc: string }[] = [
  { id: "appearance", label: "Appearance", icon: "contrast", desc: "Theme, accent, and density." },
  { id: "preview", label: "Preview", icon: "image", desc: "How .html and media files behave in the previewer." },
  { id: "vault", label: "Vault", icon: "folder", desc: "Reflects onebrain.yml — read-only." },
  { id: "about", label: "About", icon: "info", desc: "Build version, changelog, and links." },
];

// Arrow-key roving for the tablist (WAI-ARIA APG). Left/Right alias Up/Down so
// it also works when the rail wraps horizontally on narrow viewports.
const navPrev = (i: number, n: number) => (i - 1 + n) % n;
const navNext = (i: number, n: number) => (i + 1) % n;
const NAV_MOVE: Record<string, (i: number, n: number) => number> = {
  ArrowUp: navPrev,
  ArrowLeft: navPrev,
  ArrowDown: navNext,
  ArrowRight: navNext,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

// ── Reusable control rows ────────────────────────────────────────────────────
/** A labelled segmented control (2+ options). The row label doubles as the
 *  group's accessible name. */
function Seg<T extends string | boolean>(props: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onPick: (key: T) => void;
}) {
  return (
    <div class="st-row">
      <span class="st-label">{props.label}</span>
      <div class="st-seg" role="group" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={o.label}
            type="button"
            class={props.value === o.key ? "on" : ""}
            aria-pressed={props.value === o.key}
            onClick={() => props.onPick(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeRow() {
  return (
    <Seg
      label="Theme"
      value={theme.value}
      options={[
        { key: "dark", label: "Dark" },
        { key: "light", label: "Light" },
      ]}
      onPick={setTheme}
    />
  );
}

function AccentRow() {
  return (
    <div class="st-row">
      <span class="st-label">Accent</span>
      <div class="tb-acc-row">
        {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
          <button
            key={name}
            type="button"
            class={`tb-acc${accent.value === name ? " on" : ""}`}
            style={`--sw:${ACCENTS[name]}`}
            aria-label={name}
            title={name}
            aria-pressed={accent.value === name}
            onClick={() => setAccent(name)}
          />
        ))}
      </div>
    </div>
  );
}

function DensityRow() {
  return (
    <Seg
      label="Density"
      value={density.value}
      options={[
        { key: "comfortable", label: "Comfortable" },
        { key: "compact", label: "Compact" },
      ]}
      onPick={setDensity}
    />
  );
}

function HtmlRow() {
  return (
    <>
      <Seg
        label="Run HTML scripts"
        value={htmlAutorun.value}
        options={[
          { key: false, label: "Off" },
          { key: true, label: "On" },
        ]}
        onPick={setHtmlAutorun}
      />
      <p class="st-hint">
        Off (recommended): .html previews are static — use the <b>Run</b> button per file. On:
        scripts auto-run in a sandbox that still can’t reach the app, vault, or token.
      </p>
    </>
  );
}

function MediaRow() {
  return (
    <>
      <Seg
        label="Auto-play media"
        value={mediaAutoplay.value}
        options={[
          { key: false, label: "Off" },
          { key: true, label: "On" },
        ]}
        onPick={setMediaAutoplay}
      />
      <p class="st-hint">
        On: audio / video start playing when you open the file (a browser may still wait for a
        click before it plays sound).
      </p>
    </>
  );
}

// Editable settings, indexed for search. Each renders the same row component used
// in its category pane, so search results are live controls (not just links).
const ITEMS: {
  id: string;
  cat: "appearance" | "preview";
  label: string;
  keywords: string;
  Comp: () => preact.JSX.Element;
}[] = [
  { id: "theme", cat: "appearance", label: "Theme", keywords: "dark light mode colour scheme", Comp: ThemeRow },
  { id: "accent", cat: "appearance", label: "Accent", keywords: "color colour hue tint", Comp: AccentRow },
  { id: "density", cat: "appearance", label: "Density", keywords: "spacing compact comfortable", Comp: DensityRow },
  { id: "html", cat: "preview", label: "Run HTML scripts", keywords: "html scripts sandbox javascript run", Comp: HtmlRow },
  { id: "media", cat: "preview", label: "Auto-play media", keywords: "media audio video autoplay sound", Comp: MediaRow },
];

// ── Vault (read-only onebrain.yml view) ──────────────────────────────────────
/** Read-only rows describing the loaded onebrain.yml. Values are formatted
 *  defensively because the config's forward-compat keys are typed `unknown`. */
function ConfigView() {
  const cfg = vaultConfig.value;
  if (!cfg) return <div class="st-empty">No vault config loaded.</div>;

  const scalar = (v: unknown): string | null =>
    typeof v === "string" || typeof v === "number" ? String(v) : null;

  const rows: { label: string; value: string }[] = [];
  const channel = scalar(cfg.update_channel);
  if (channel) rows.push({ label: "Update channel", value: channel });
  if (cfg.qmd_collection) rows.push({ label: "qmd collection", value: cfg.qmd_collection });
  const cp = cfg.checkpoint;
  if (cp && (cp.messages != null || cp.minutes != null)) {
    rows.push({ label: "Checkpoint", value: `${cp.messages ?? "—"} msgs · ${cp.minutes ?? "—"} min` });
  }
  const recap = cfg.recap as { min_sessions?: number; min_frequency?: number } | undefined;
  if (recap && (recap.min_sessions != null || recap.min_frequency != null)) {
    rows.push({
      label: "Recap",
      value: `≥${recap.min_sessions ?? "—"} sessions · every ${recap.min_frequency ?? "—"}`,
    });
  }
  const schedule = Array.isArray(cfg.schedule) ? cfg.schedule : [];
  if (schedule.length) rows.push({ label: "Scheduled jobs", value: String(schedule.length) });

  const folders = cfg.folders ?? {};
  return (
    <>
      <div class="st-ro-note">
        <Icon name="alert" class="st-ro-ic" /> Read-only — edit onebrain.yml to change these.
      </div>
      {rows.map((r) => (
        <div class="st-row" key={r.label}>
          <span class="st-label">{r.label}</span>
          <span class="st-val">{r.value}</span>
        </div>
      ))}
      {Object.keys(folders).length > 0 && (
        <div class="st-folders">
          <span class="st-label">Folders</span>
          <div class="st-folder-grid">
            {Object.entries(folders).map(([k, v]) => (
              <div class="st-folder" key={k}>
                <code>{k}</code>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── About (version + What's new + links) ─────────────────────────────────────
/** Latest changelog entry, fetched from the emitted /changelog.json artifact. */
function WhatsNew() {
  // undefined = loading, null = changelog has no entries, entry = ready.
  const entry = useSignal<ChangelogEntry | null | undefined>(undefined);
  const failed = useSignal(false);
  useEffect(() => {
    // Cancel the request if the user leaves About before it lands. A late
    // resolve/reject after unmount only writes to this instance's own orphaned
    // signals, which @preact/signals handles without an unmounted-update warning.
    const ac = new AbortController();
    fetchChangelog(ac.signal)
      .then((d) => {
        entry.value = latestEntry(d);
      })
      .catch(() => {
        failed.value = true;
      });
    return () => ac.abort();
  }, []);

  if (failed.value) return <div class="st-wn-note">Couldn’t load the changelog.</div>;
  if (entry.value === undefined) return <div class="st-wn-note">Loading…</div>;
  if (entry.value === null) return <div class="st-wn-note">No changelog yet.</div>;
  const e = entry.value;
  return (
    <div class="st-wn">
      <div class="st-wn-head">
        <span class="st-wn-ver">v{e.version}</span>
        {e.date ? <span class="st-wn-date">{e.date}</span> : null}
      </div>
      <div
        class="st-wn-body"
        // renderMarkdown sanitizes (DOMPurify) — the changelog is first-party anyway.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(e.markdown).html }}
      />
    </div>
  );
}

function AboutPane() {
  const connected = vaultConfig.value != null;
  // Flex column: the fixed rows + eyebrow + "Full changelog" link stay put; only
  // the WhatsNew card between them grows to fill the pane and scrolls internally.
  return (
    <div class="st-about">
      <div class="st-row">
        <span class="st-label">Version</span>
        <span class="st-val" data-testid="st-version">v{__APP_VERSION__}</span>
      </div>
      <div class="st-row">
        <span class="st-label">Daemon</span>
        <span class="st-val">{connected ? "Connected" : "Connecting…"}</span>
      </div>
      <div class="st-row">
        <span class="st-label">Repository</span>
        <a class="st-link" href={__APP_REPO__} target="_blank" rel="noreferrer noopener">
          {__APP_REPO__.replace(/^https?:\/\//, "")}
        </a>
      </div>
      <div class="st-wn-section">What’s new</div>
      <WhatsNew />
      <a
        class="st-link st-wn-full"
        href={`${__APP_REPO__}/blob/main/CHANGELOG.md`}
        target="_blank"
        rel="noreferrer noopener"
      >
        Full changelog →
      </a>
    </div>
  );
}

// ── Panes ────────────────────────────────────────────────────────────────────
function ItemList({ cat }: { cat: "appearance" | "preview" }) {
  return (
    <>
      {ITEMS.filter((i) => i.cat === cat).map((i) => (
        <i.Comp key={i.id} />
      ))}
    </>
  );
}

function PaneHead({ cat }: { cat: SettingsCat }) {
  const c = CATEGORIES.find((x) => x.id === cat)!;
  return (
    <div class="st-pane-head">
      <div class="st-pane-title">{c.label}</div>
      <div class="st-pane-desc">{c.desc}</div>
    </div>
  );
}

function CatPane({ cat }: { cat: SettingsCat }) {
  return (
    <>
      <PaneHead cat={cat} />
      {cat === "appearance" && <ItemList cat="appearance" />}
      {cat === "preview" && <ItemList cat="preview" />}
      {cat === "vault" && <ConfigView />}
      {cat === "about" && <AboutPane />}
    </>
  );
}

function Results({ results, query }: { results: typeof ITEMS; query: string }) {
  if (results.length === 0) {
    return <div class="st-empty">No settings match “{query}”.</div>;
  }
  return (
    <>
      <div class="st-pane-head">
        <div class="st-pane-title">Results</div>
        <div class="st-pane-desc">
          {results.length} setting{results.length === 1 ? "" : "s"} matching “{query}”.
        </div>
      </div>
      {results.map((i) => (
        <div class="st-result" key={i.id}>
          <span class="st-result-cat">{i.cat}</span>
          <i.Comp />
        </div>
      ))}
    </>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────────
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLButtonElement[]>([]);
  const query = useSignal("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Tab") trapFocus(e, dialogRef.current);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const active = settingsCategory.value;
  const q = query.value.trim();
  const searching = q !== "";
  const needle = q.toLowerCase();
  const results = ITEMS.filter((i) => `${i.label} ${i.keywords}`.toLowerCase().includes(needle));

  function pick(cat: SettingsCat) {
    setSettingsCategory(cat);
    query.value = "";
  }
  function onNavKey(e: KeyboardEvent, idx: number) {
    const move = NAV_MOVE[e.key];
    if (!move) return;
    e.preventDefault();
    const next = move(idx, CATEGORIES.length);
    pick(CATEGORIES[next].id);
    tabsRef.current[next].focus();
  }

  // Portal to <body>: the topbar (this component's host) sets `backdrop-filter`,
  // which makes a position:fixed descendant relative to the TOPBAR box instead of
  // the viewport. Rendering into body escapes that containing block.
  return createPortal(
    <div
      class="ob-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="ob-modal st-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={dialogRef}
        data-testid="settings-modal"
      >
        <div class="st-head">
          <div class="ob-modal-title">Settings</div>
          <label class="st-search">
            <Icon name="search" class="st-search-ic" />
            <input
              class="st-search-in"
              type="search"
              placeholder="Search settings"
              aria-label="Search settings"
              value={query.value}
              onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="st-body">
          <nav class="st-nav" role="tablist" aria-orientation="vertical" aria-label="Settings categories">
            {CATEGORIES.map((c, i) => {
              // Roving tabindex: exactly one tab stays selected + focusable, even
              // while searching (the results view is an overlay, not a 5th tab).
              const selected = c.id === active;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  id={`st-tab-${c.id}`}
                  aria-selected={selected}
                  aria-controls="st-panel"
                  tabIndex={selected ? 0 : -1}
                  class={selected ? "st-tab on" : "st-tab"}
                  ref={(el) => {
                    if (el) tabsRef.current[i] = el;
                  }}
                  onClick={() => pick(c.id)}
                  onKeyDown={(e) => onNavKey(e, i)}
                >
                  <Icon name={c.icon} class="st-tab-ic" />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            class="st-pane"
            role="tabpanel"
            id="st-panel"
            aria-label={searching ? "Search results" : undefined}
            aria-labelledby={searching ? undefined : `st-tab-${active}`}
          >
            {searching ? <Results results={results} query={q} /> : <CatPane cat={active} />}
          </div>
        </div>

        <div class="ob-modal-actions">
          <button type="button" class="ob-modal-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
