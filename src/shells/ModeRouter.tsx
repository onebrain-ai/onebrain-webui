// ModeRouter — mounts one shell at a time (spec §5, decision D1). v1 has only
// the always-available `CmsShell`; the lazy WebGL `CommandCenterShell` (the
// ported Three.js prototype) slots in here behind a `mode` signal + GPU/host
// gating once it's built. Kept as the single switch point so adding the 3D mode
// is additive, not a rewrite.

import { CmsShell } from "./CmsShell";
import type { PanelContext } from "../panels/panel";

export function ModeRouter({ ctx }: { ctx: PanelContext }) {
  // Only CMS for now. Later: read a `mode` signal, lazy-import
  // CommandCenterShell, and gate it on `ctx.hostEnv` + WebGL2 capability.
  return <CmsShell ctx={ctx} />;
}
