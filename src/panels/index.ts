// Panel plugin manifest — the one place that knows the full panel set.
// Registers every panel in display order. Adding a panel = author its folder,
// import its def here, and add it to the list. No shell code changes.
//
// Display order mirrors the prototype's TYPE_ORDER. Panels are registered as
// they are ported; the remaining types (explorer, preview, chat, cli, search,
// skills, log, tasks) land in M4.

import { registerPanel } from "./registry";
import { statusPanel } from "./status/status";
import { composerPanel } from "./composer/composer";

const PANELS = [statusPanel, composerPanel];

for (const def of PANELS) registerPanel(def);

export { allPanels, getPanel, seedPanels } from "./registry";
