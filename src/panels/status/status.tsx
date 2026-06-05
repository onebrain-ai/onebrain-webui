// Status panel — the operator's at-a-glance system readout. Mock data for now
// (matches the prototype); wires to live daemon/session telemetry in a later
// pass. Ported from the prototype template (lines 1194–1211).

import type { PanelDef } from "../contract";
import "./status.css";

function Status() {
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          System · Online
        </span>
        <span class="w-meta">HUD_01</span>
      </div>
      <div class="brand">
        <svg class="ob-mark" aria-hidden="true">
          <use href="#ob-brain-mark" />
        </svg>
        <span>
          <b>One</b>Brain
        </span>
      </div>
      <ul class="stat-lines">
        <li>
          <span>NODE · NETWORK</span>
          <b>
            :: <em>ONLINE</em> · FPS <span class="fps2">60</span>
          </b>
        </li>
        <li>
          <span>HARNESS</span>
          <b>:: CLAUDE CODE · v3.1.6</b>
        </li>
        <li>
          <span>VAULT</span>
          <b>:: SYNCED · 1,284 notes</b>
        </li>
        <li>
          <span>MEMORY</span>
          <b>:: 47 facts</b>
        </li>
      </ul>
      <div class="metric-row">
        <div class="metric">
          <div class="m-val">6</div>
          <div class="m-lab">sessions</div>
        </div>
        <div class="metric">
          <div class="m-val">3</div>
          <div class="m-lab">due</div>
        </div>
        <div class="metric">
          <div class="m-val">12</div>
          <div class="m-lab">inbox</div>
        </div>
      </div>
    </>
  );
}

export const statusPanel: PanelDef = {
  type: "status",
  name: "Status",
  width: 362,
  placement: { t: -1.3, y: 0.7, r: 7.0, s: 0.005 },
  seed: false, // not in the prototype's SEED arc; spawn via add-panel / ⌘K
  Component: Status,
};
