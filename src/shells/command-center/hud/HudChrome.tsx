// HUD chrome overlay — topbar + radar + heading tape, mounted into #app over the
// 3D field. The radar + heading <canvas>es are drawn each frame by the engine
// (which queries them by id after this mounts); their captions are reactive.

import { TopBar } from "./TopBar";
import { radarCount, radarHeading } from "./store";
import "./hud.css";

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
    </>
  );
}
