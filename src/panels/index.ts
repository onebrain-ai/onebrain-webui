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
import { searchPanel } from "./search/search";
import { statusPanel } from "./status/status";
import { memoryPanel } from "./memory/memory";
import { tasksPanel } from "./tasks/tasks";

// Registration order = display order. The CmsShell mounts panels by type
// (editor as the main pane, chat as the dock, explorer/search/tasks/memory/
// status in the activity rail); files + preview remain registered for the
// open-file flow.
const PANELS = [
  filesPanel,
  explorerPanel,
  previewPanel,
  editorPanel,
  chatPanel,
  searchPanel,
  statusPanel,
  memoryPanel,
  tasksPanel,
];

for (const def of PANELS) registerPanel(def);

export { allPanels, getPanel, seedPanels } from "./registry";
