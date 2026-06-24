// Boot overlay bundle — the boot screen + warp transition + toast + first-run
// hint, mounted together over the field. The boot screen sits on top (z-50) and
// covers the running scene until Enter warps it away.

import { Boot } from "./Boot";
import { Warp } from "./Warp";
import { Toast } from "./Toast";
import { FirstRun } from "./FirstRun";

export function BootOverlay() {
  return (
    <>
      <Boot />
      <Warp />
      <Toast />
      <FirstRun />
    </>
  );
}
