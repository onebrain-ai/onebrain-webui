// HUD chrome overlay — topbar + radar + heading tape, mounted into #app over the
// 3D field. The radar + heading <canvas>es are drawn each frame by the engine
// (which queries them by id after this mounts); their captions are reactive.

import { TopBar } from "./TopBar";
import { radarCount, radarHeading } from "./store";
import "./hud.css";
import "./views.css";

export function HudChrome() {
  return (
    <>
      <TopBar />
      <div id="radar">
        <div class="r-frame">
          <canvas width="320" height="320" />
        </div>
        <div class="r-cap">
          <span>
            RADAR · <b>{radarCount.value}</b> IN RANGE
          </span>
          <span>{String(radarHeading.value).padStart(3, "0")}°</span>
        </div>
      </div>
      <div id="heading">
        <canvas />
      </div>

      {/* workspaces drawer (telescopes up out of the radar) — populated imperatively by camera/views */}
      <div id="views">
        <div id="view-list" />
      </div>
      <button id="views-handle" type="button" aria-label="Toggle workspaces">
        <svg viewBox="0 0 24 24">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
        <span class="hud-lab">Workspaces</span>
      </button>
    </>
  );
}
