// ModeRouter — mounts one shell at a time (spec §5, decision D1). The 3D
// `CommandCenterShell` is a lazy chunk: its Three.js weight is only fetched when
// the user actually enters the command center, so the CMS-only path stays light
// (the "fast + Pi" constraint). 3D is gated on WebGL2 — a host without it falls
// back to the CMS shell.

import { lazy, Suspense } from "preact/compat";
import { mode, hasWebGL2 } from "../core/stores";
import { CmsShell } from "./CmsShell";
import type { PanelContext } from "../panels/panel";

const CommandCenterShell = lazy(() =>
  import("./command-center/CommandCenterShell").then((m) => ({ default: m.CommandCenterShell })),
);

export function ModeRouter({ ctx }: { ctx: PanelContext }) {
  // Reading `mode.value` here subscribes the router to mode switches.
  if (mode.value === "command-center" && hasWebGL2()) {
    return (
      <Suspense fallback={<div class="cc-loading">Booting command center…</div>}>
        <CommandCenterShell ctx={ctx} />
      </Suspense>
    );
  }
  return <CmsShell ctx={ctx} />;
}
