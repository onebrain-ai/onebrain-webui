import { useEffect } from "preact/hooks";
import type { DaemonClient } from "../../core/daemon";
import type { PanelContext } from "../../panels/contract";
import { getPanel } from "../../panels";
import { initVault, openFile } from "../../panels/bus";
import { setMode, chatOpen } from "../../core/stores";
import "./cms.css";

/** A 2D panel context: the write-capable daemon, the cross-panel open action,
 *  and a no-op `addPanel` (the CMS has fixed zones, not a free panel arc). */
function ctxFor(daemon: DaemonClient): PanelContext {
  return { daemon, openFile, addPanel: () => {} };
}

export function CmsShell({ daemon }: { daemon: DaemonClient }) {
  useEffect(() => {
    void initVault(daemon);
  }, [daemon]);

  const ctx = ctxFor(daemon);
  const Explorer = getPanel("explorer")!.Component;
  const Main = getPanel("preview")!.Component; // Task 7 → "editor"
  const Chat = getPanel("chat")!.Component;

  return (
    <div class="cms" data-testid="cms-shell" data-chat={chatOpen.value ? "open" : "closed"}>
      <nav class="cms-rail" data-testid="cms-rail">
        <button class="cms-rail-btn is-active" title="Notes">▪</button>
        <button
          class="cms-rail-btn"
          data-testid="cms-mode-3d"
          title="3D command center"
          onClick={() => setMode("command-center")}
        >
          ◆
        </button>
      </nav>
      <aside class="cms-explorer" data-testid="cms-explorer">
        <Explorer ctx={ctx} />
      </aside>
      <main class="cms-main" data-testid="cms-main">
        <Main ctx={ctx} />
      </main>
      {chatOpen.value && (
        <aside class="cms-chat" data-testid="cms-chat">
          <Chat ctx={ctx} />
        </aside>
      )}
    </div>
  );
}
