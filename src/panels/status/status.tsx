// Status panel — the operator's at-a-glance system readout, computed from REAL
// vault state: the daemon connection (the tree loaded), note / inbox / memory /
// session counts from the loaded vault tree, and the live due-task count.

import type { PanelDef } from "../contract";
import { vaultTree, vaultError, allFiles, vaultConfig } from "../bus";
import { dueCount } from "../tasks-store";
import "./status.css";

function Status() {
  const tree = vaultTree.value; // subscribe → re-compute when the vault loads
  const ready = tree !== null;
  const files = ready ? allFiles() : [];

  // Folder names from the vault config (falls back to the PARA defaults) so a
  // vault that renamed folders in onebrain.yml still counts correctly.
  const folders = vaultConfig.value?.folders ?? {};
  const dir = (key: string, dflt: string) => (folders[key] ?? dflt).toLowerCase().replace(/\/$/, "");
  const inboxDir = dir("inbox", "00-inbox");
  const agentDir = dir("agent", "05-agent");
  const logsDir = dir("logs", "07-logs");

  const lc = (p: string) => p.toLowerCase();
  const notes = files.filter((p) => lc(p).endsWith(".md")).length;
  const inbox = files.filter((p) => lc(p).startsWith(inboxDir + "/")).length;
  const memory = files.filter((p) => lc(p).startsWith(agentDir + "/memory/") && lc(p).endsWith(".md")).length;
  const sessions = files.filter((p) => lc(p).startsWith(logsDir + "/session/") && lc(p).endsWith(".md")).length;

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          System · {ready ? "Online" : "Connecting"}
        </span>
        <span class="w-meta">HUD_01</span>
      </div>
      <div class="st-brand">
        <svg class="ob-mark" aria-hidden="true">
          <use href="#ob-brain-mark" />
        </svg>
        <span>
          <b>One</b>Brain
        </span>
      </div>
      <ul class="stat-lines">
        <li>
          <span>DAEMON</span>
          <b>
            :: <em class={ready ? "ok" : "off"}>{ready ? "ONLINE" : vaultError.value ? "OFFLINE" : "…"}</em>
          </b>
        </li>
        <li>
          <span>VAULT</span>
          <b>:: {ready ? "SYNCED" : "…"} · {notes.toLocaleString()} notes</b>
        </li>
        <li>
          <span>MEMORY</span>
          <b>:: {memory} notes</b>
        </li>
        <li>
          <span>SESSIONS</span>
          <b>:: {sessions} logged</b>
        </li>
      </ul>
      <div class="metric-row">
        <div class="metric">
          <div class="m-val">{notes.toLocaleString()}</div>
          <div class="m-lab">notes</div>
        </div>
        <div class="metric">
          <div class="m-val">{dueCount.value}</div>
          <div class="m-lab">due</div>
        </div>
        <div class="metric">
          <div class="m-val">{inbox}</div>
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
