import type { DaemonClient } from "../../core/daemon";

export function CmsShell({ daemon: _daemon }: { daemon: DaemonClient }) {
  return <div data-testid="cms-shell">CMS</div>;
}
