// Panel registry — the plugin table both shells read from.
//
// Panels self-describe via `PanelDef`; `panels/index.ts` registers them in a
// fixed display order. The shells never hard-code a panel list — they ask the
// registry. This is what makes a new panel a one-line addition.

import type { PanelDef } from "./contract";

const _registry = new Map<string, PanelDef>();
/** registration order = display order (rail / add-menu). */
const _order: string[] = [];

/** Register a panel plugin. Idempotent per type (last registration wins, with a
 *  dev warning) so hot-reload re-registration doesn't duplicate the table. */
export function registerPanel(def: PanelDef): void {
  if (!_registry.has(def.type)) _order.push(def.type);
  else if (import.meta.env?.DEV) {
    console.warn(`[panels] re-registering "${def.type}"`);
  }
  _registry.set(def.type, def);
}

/** Look up one panel def by type. */
export function getPanel(type: string): PanelDef | undefined {
  return _registry.get(type);
}

/** All registered panels, in registration (display) order. */
export function allPanels(): PanelDef[] {
  return _order.map((t) => _registry.get(t)!).filter(Boolean);
}

/** The panels shown on a fresh first load (no saved layout). */
export function seedPanels(): PanelDef[] {
  return allPanels().filter((p) => p.seed);
}
