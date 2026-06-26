// Settings modal — opened from the topbar gear. Two sections: editable
// Appearance (accent + density, persisted to localStorage via core/stores) and a
// READ-ONLY view of the loaded onebrain.yml (folders, qmd, schedule, thresholds).
// Config editing is intentionally not offered here — the vault file stays the
// source of truth; this surface only reflects it.

import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import {
  ACCENTS,
  accent,
  setAccent,
  density,
  setDensity,
  theme,
  setTheme,
  type AccentName,
} from "../../core/stores";
import { vaultConfig } from "../../panels/bus";
import { trapFocus } from "../../ui/Modal";
import "./settings-modal.css";

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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Tab") trapFocus(e, dialogRef.current);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Portal to <body>: the topbar (this component's host) sets `backdrop-filter`,
  // which makes a position:fixed descendant relative to the TOPBAR box instead of
  // the viewport — trapping the overlay in the top strip. Rendering into body
  // (like ModalHost/TaskModalHost) escapes that containing block.
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
        <div class="ob-modal-title">Settings</div>

        <div class="st-section">Appearance</div>
        <div class="st-row">
          <span class="st-label">Theme</span>
          <div class="st-seg" role="group" aria-label="Theme">
            <button
              type="button"
              class={theme.value === "dark" ? "on" : ""}
              aria-pressed={theme.value === "dark"}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
            <button
              type="button"
              class={theme.value === "light" ? "on" : ""}
              aria-pressed={theme.value === "light"}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
          </div>
        </div>
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
        <div class="st-row">
          <span class="st-label">Density</span>
          <div class="st-seg" role="group" aria-label="Density">
            <button
              type="button"
              class={density.value === "comfortable" ? "on" : ""}
              aria-pressed={density.value === "comfortable"}
              onClick={() => setDensity("comfortable")}
            >
              Comfortable
            </button>
            <button
              type="button"
              class={density.value === "compact" ? "on" : ""}
              aria-pressed={density.value === "compact"}
              onClick={() => setDensity("compact")}
            >
              Compact
            </button>
          </div>
        </div>

        <div class="st-section">
          Vault config <span class="st-ro">read-only · onebrain.yml</span>
        </div>
        <ConfigView />

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
