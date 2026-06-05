// Settings panel — appearance (DS accent + density), behaviour (chat dock), and
// a read-only view of the vault config (`GET /api/config`). Styled with DS
// tokens; the accent swatches follow the DS `.accent-dot` pattern (the one place
// a solid-accent fill is legitimate — the swatch IS the color).

import { useEffect, useState } from "preact/hooks";
import {
  ACCENTS,
  accent,
  setAccent,
  density,
  setDensity,
  chatOpen,
  setChatOpen,
} from "../core/stores";
import type { AccentName } from "../core/stores";
import { DaemonError } from "../core/types";
import type { OnebrainConfig } from "../core/types";
import { registerPanel } from "./panel";
import type { PanelContext } from "./panel";
import { mountComponent } from "./mount";

function SettingsView({ ctx }: { ctx: PanelContext }) {
  const [config, setConfig] = useState<OnebrainConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ctx.daemon
      .config()
      .then((c) => live && setConfig(c))
      .catch((e: unknown) => live && setConfigError(describe(e)));
    return () => {
      live = false;
    };
  }, [ctx.daemon]);

  return (
    <section class="ob-settings">
      <h1>Settings</h1>

      <div class="ob-settings-group-head">Appearance</div>

      <div class="ob-setting-row">
        <div class="ob-setting-label">
          <span class="t">Accent</span>
          <span class="d">Re-tints the surface — one accent per surface (DS).</span>
        </div>
        <div class="accent-dots" role="radiogroup" aria-label="Accent color">
          {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
            <button
              key={name}
              class={`accent-dot${accent.value === name ? " is-sel" : ""}`}
              // DS swatch keys its fill off `--sw` (the dot IS the color).
              style={{ "--sw": ACCENTS[name] }}
              role="radio"
              aria-checked={accent.value === name}
              aria-label={name}
              title={name}
              onClick={() => setAccent(name)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div class="ob-setting-row">
        <div class="ob-setting-label">
          <span class="t">Density</span>
          <span class="d">Compact tightens controls (DS data-density).</span>
        </div>
        <label class="cyber-switch">
          <input
            type="checkbox"
            checked={density.value === "compact"}
            aria-label="Compact density"
            onChange={(e) =>
              setDensity((e.currentTarget as HTMLInputElement).checked ? "compact" : "comfortable")
            }
          />
        </label>
      </div>

      <div class="ob-settings-group-head">Behaviour</div>

      <div class="ob-setting-row">
        <div class="ob-setting-label">
          <span class="t">Chat dock</span>
          <span class="d">Show the chat panel on the right by default.</span>
        </div>
        <label class="cyber-switch">
          <input
            type="checkbox"
            checked={chatOpen.value}
            aria-label="Show chat dock"
            onChange={(e) => setChatOpen((e.currentTarget as HTMLInputElement).checked)}
          />
        </label>
      </div>

      <div class="ob-settings-group-head">Vault config</div>
      {configError && <div class="ob-panel-error">⚠ {configError}</div>}
      {config && (
        <pre class="ob-config-dump">{JSON.stringify(config, null, 2)}</pre>
      )}
    </section>
  );
}

function describe(e: unknown): string {
  if (e instanceof DaemonError) {
    return e.status === 0 ? e.message : `${e.message} (HTTP ${e.status})`;
  }
  return e instanceof Error ? e.message : String(e);
}

registerPanel({
  type: "settings",
  name: "Settings",
  icon: "SET",
  build: (container, ctx) => mountComponent(container, ctx, SettingsView),
});
