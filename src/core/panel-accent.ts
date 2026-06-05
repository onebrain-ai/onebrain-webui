// Per-panel accent overrides — each widget may pin its own accent (the header
// swatch), independent of the global UI accent. Persisted as a flat
// widgetKey→accentKey map. Ported from the prototype (PANEL_ACC_KEY / panelAccents
// 1954-1956, setPanelAccent persistence 1970-1975).

import { ACCENT_HEX } from "./accent";

const STORE_KEY = "ob-spatial-panel-accents";

function load(): Record<string, string> {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return m && typeof m === "object" ? (m as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const panelAccents = load();

/** the saved accent KEY for a widget, or null if it inherits the global accent. */
export function panelAccent(key: string): string | null {
  const a = panelAccents[key];
  return a && ACCENT_HEX[a] ? a : null;
}

/** Pin (accent key) or clear (null) a widget's accent, then persist the map. */
export function setStoredPanelAccent(key: string, accent: string | null): void {
  if (accent && ACCENT_HEX[accent]) panelAccents[key] = accent;
  else delete panelAccents[key];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(panelAccents));
  } catch {
    /* ignore */
  }
}
