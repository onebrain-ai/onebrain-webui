// First-run hint — a one-time, dismissible control legend shown after the warp
// settles. Ported from the prototype (markup 1137–1145, CSS 875–886).

import { firstRunShow, dismissFirstRun } from "./store";
import "./firstrun.css";

export function FirstRun() {
  return (
    <div id="firstrun" class={firstRunShow.value ? "show" : ""}>
      <div class="fr-h">
        <span class="dot" />
        Welcome to your command center
      </div>
      <div class="fr-keys">
        <span>
          <b>W / S</b> move
        </span>
        <span>
          <b>A / D</b> turn
        </span>
        <span>
          <b>Q / E</b> strafe
        </span>
        <span>
          <b>Drag</b> look
        </span>
        <span>
          <b>Dbl-click</b> focus a panel
        </span>
        <span>
          <b>0</b> show all
        </span>
        <span>
          <b>＋</b> add panel
        </span>
      </div>
      <button class="btn-tech fr-go" type="button" onClick={() => dismissFirstRun()}>
        <span>Got it · press H anytime for shortcuts</span>
      </button>
    </div>
  );
}
