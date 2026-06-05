// Panel plugin manifest — the one place that knows the full panel set.
// Registers every panel in display order (the prototype's TYPE_ORDER). Adding a
// panel = author its folder, import its def here, add it to the list. No shell
// code changes.

import { registerPanel } from "./registry";
import { explorerPanel } from "./explorer/explorer";
import { previewPanel } from "./preview/preview";
import { chatPanel } from "./chat/chat";
import { cliPanel } from "./cli/cli";
import { searchPanel } from "./search/search";
import { statusPanel } from "./status/status";
import { composerPanel } from "./composer/composer";
import { skillsPanel } from "./skills/skills";
import { logPanel } from "./log/log";
import { tasksPanel } from "./tasks/tasks";

// TYPE_ORDER (prototype): explorer · preview · chat · cli · search · status ·
// composer · skills · log · tasks. The 5 SEED panels (explorer/preview/chat/
// composer/log) form the default cockpit arc; the rest spawn via add-panel / ⌘K.
const PANELS = [
  explorerPanel,
  previewPanel,
  chatPanel,
  cliPanel,
  searchPanel,
  statusPanel,
  composerPanel,
  skillsPanel,
  logPanel,
  tasksPanel,
];

for (const def of PANELS) registerPanel(def);

export { allPanels, getPanel, seedPanels } from "./registry";
