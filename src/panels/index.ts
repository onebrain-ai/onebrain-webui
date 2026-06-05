// Panel plugin manifest — the one place that knows the full panel set.
// Registers every panel in display order (the prototype's TYPE_ORDER). Adding a
// panel = author its folder, import its def here, add it to the list. No shell
// code changes.
//
// Remaining types (cli, search, skills, tasks) land in a later milestone.

import { registerPanel } from "./registry";
import { explorerPanel } from "./explorer/explorer";
import { previewPanel } from "./preview/preview";
import { chatPanel } from "./chat/chat";
import { statusPanel } from "./status/status";
import { composerPanel } from "./composer/composer";
import { logPanel } from "./log/log";

// TYPE_ORDER: explorer · preview · chat · (cli · search ·) status · composer ·
// (skills ·) log · (tasks). The 5 SEED panels (explorer/preview/chat/composer/
// log) form the default cockpit arc.
const PANELS = [explorerPanel, previewPanel, chatPanel, statusPanel, composerPanel, logPanel];

for (const def of PANELS) registerPanel(def);

export { allPanels, getPanel, seedPanels } from "./registry";
