// Bridge a Preact component to the imperative `PanelDef.build()` contract.
//
// Panels are authored as ordinary Preact components (ergonomic, testable), but
// the Panel contract (§6.2) is imperative DOM so it also works inside the 3D
// shell's `CSS3DObject` container. `mountComponent` reconciles the two: render
// the component into the host's container, and tear it down on `unmount`.

import { render } from "preact";
import type { ComponentType } from "preact";
import type { PanelContext, PanelInstance } from "./panel";

/** Render `Component` into `container`, returning a `PanelInstance` that cleanly
 *  unmounts it (Preact `render(null, container)` detaches and runs cleanup). */
export function mountComponent(
  container: HTMLElement,
  ctx: PanelContext,
  Component: ComponentType<{ ctx: PanelContext }>,
): PanelInstance {
  render(<Component ctx={ctx} />, container);
  return {
    unmount() {
      render(null, container);
    },
  };
}
