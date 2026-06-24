// Warp transition — a scanline shutter that closes from top+bottom to a center
// line, then opens outward into the field. Ported from the prototype (markup
// 1124–1128, CSS 810–829). The element's class is mutated directly by
// store.leaveBoot (via warpRef) — see warpRef's note on why a signal won't do.

import { warpRef } from "./store";
import "./warp.css";

// stable ref callback — a new closure each render would cycle warpRef through
// null on every parent re-render.
const setWarpRef = (el: HTMLElement | null) => {
  warpRef.current = el;
};

export function Warp() {
  return (
    <div id="warp" aria-hidden="true" ref={setWarpRef}>
      <div class="warp-band top" />
      <div class="warp-band bot" />
      <div class="warp-mid">
        <span class="warp-line" />
        <span class="warp-status">Entering · OneBrain Command Center</span>
      </div>
    </div>
  );
}
