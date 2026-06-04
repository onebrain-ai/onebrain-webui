// PanelHost — mounts a registered panel (by `type`) into a DOM region using the
// imperative `PanelDef.build()` contract. This is the flat (CMS) host; the 3D
// shell will have a spatial host that mounts the SAME panels into CSS3DObjects.

import { useEffect, useRef } from "preact/hooks";
import { getPanel } from "./panel";
import type { PanelContext } from "./panel";

export function PanelHost({ type, ctx }: { type: string; ctx: PanelContext }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    const def = getPanel(type);
    if (!container || !def) return;
    const instance = def.build(container, ctx);
    return () => instance.unmount();
  }, [type, ctx]);

  const def = getPanel(type);
  if (!def) return <div class="ob-panel-error">⚠ unknown panel: {type}</div>;
  return <div class="ob-panel-host" ref={ref} data-panel={type} />;
}
