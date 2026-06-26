// Panel plugin manifest — the one place that knows the full panel set.
// Registers every panel in display order (the prototype's TYPE_ORDER). Adding a
// panel = author its folder, import its def here, add it to the list. No shell
// code changes.

import { registerPanel } from "./registry";
import { filesPanel } from "./files/files";
import { explorerPanel } from "./explorer/explorer";
import { previewPanel } from "./preview/preview";
import { editorPanel } from "./editor/editor";
import { chatPanel } from "./chat/chat";
import { cliPanel } from "./cli/cli";
import { searchPanel } from "./search/search";
import { statusPanel } from "./status/status";
import { memoryPanel } from "./memory/memory";
import { composerPanel } from "./composer/composer";
import { skillsPanel } from "./skills/skills";
import { logPanel } from "./log/log";
import { tasksPanel } from "./tasks/tasks";

// Display order for the add-menu / ⌘K. The combined File Browser leads; the
// standalone Explorer + Preview remain available (spawnable) but are no longer
// seeded. The 4 SEED panels (files / chat / composer / log) form the default
// cockpit arc; the rest spawn via add-panel / ⌘K.
const PANELS = [
  filesPanel,
  explorerPanel,
  previewPanel,
  editorPanel,
  chatPanel,
  cliPanel,
  searchPanel,
  statusPanel,
  memoryPanel,
  composerPanel,
  skillsPanel,
  logPanel,
  tasksPanel,
];

for (const def of PANELS) registerPanel(def);

export { allPanels, getPanel, seedPanels } from "./registry";
