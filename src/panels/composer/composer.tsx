// Composer panel — the slash-command / capture input that anchors the cockpit.
// Ported from the prototype template (lines 1213–1222). Slash autocomplete +
// run wiring land in M4; this is the faithful visual shell.

import type { PanelDef, PanelContext } from "../contract";
import "./composer.css";

function Composer(_props: { ctx: PanelContext }) {
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          // Composer
        </span>
        <span class="w-meta">⌘K</span>
      </div>
      <div class="composer">
        <span class="slash">/</span>
        <input class="cmd-input" type="text" placeholder="run a skill, or capture a thought…" autocomplete="off" />
        <button class="btn-tech">
          <span>Run</span>
        </button>
      </div>
      <div class="composer-hint">
        Type <kbd>/</kbd> for skills · <kbd>Enter</kbd> to run · dbl-click panel to focus
      </div>
    </>
  );
}

export const composerPanel: PanelDef = {
  type: "composer",
  name: "Composer",
  width: 362,
  placement: { t: 0.06, y: -1.5, r: 5.1, s: 0.005 },
  seed: true,
  Component: Composer,
};
