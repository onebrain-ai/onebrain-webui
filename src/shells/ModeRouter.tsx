import { useEffect, useRef } from "preact/hooks";
import { mode } from "../core/stores";
import { CmsShell } from "./cms/CmsShell";
import { startCommandCenter } from "./command-center/engine";
import { HudChrome } from "./command-center/hud/HudChrome";
import { BootOverlay } from "./command-center/boot/BootOverlay";
import type { DaemonClient } from "../core/daemon";

/** Boot-time surface selector. Reads `mode` once at mount (a reload applies a
 *  changed mode — the 3D engine is imperative and not hot-swappable mid-session). */
export function ModeRouter({ daemon }: { daemon: DaemonClient }) {
  if (mode.value === "command-center") return <CommandCenterHost daemon={daemon} />;
  return <CmsShell daemon={daemon} />;
}

function CommandCenterHost({ daemon }: { daemon: DaemonClient }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startCommandCenter({ daemon });
  }, [daemon]);
  return (
    <>
      <HudChrome />
      <BootOverlay />
    </>
  );
}
