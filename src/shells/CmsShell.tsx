// CmsShell — the 2D mode (spec §7), = the 05-29 Layout A: rail + main + chat
// dock. For a file-centric PKM v1 the "main" region is split into a persistent
// Explorer sidebar (navigation) and a Preview pane (content) — both are real
// panels mounted through the one Panel contract, so the command-center shell
// can later mount the same two as floating surfaces.
//
// Chat dock is a stub: the agent runtime (ChatTransport) isn't wired yet, so the
// dock shows a "coming soon" placeholder rather than a dead input.

import { chatOpen, setChatOpen } from "../core/stores";
import { PanelHost } from "../panels/host";
import type { PanelContext } from "../panels/panel";

export function CmsShell({ ctx }: { ctx: PanelContext }) {
  return (
    <div class={`ob-cms${chatOpen.value ? " chat-open" : ""}`}>
      <aside class="ob-rail" aria-label="Primary">
        <div class="ob-rail-brand" title="OneBrain">OB</div>
        <button class="ob-rail-item is-active" title="Explorer">EX</button>
        <div class="ob-rail-spacer" />
        <button
          class={`ob-rail-item${chatOpen.value ? " is-active" : ""}`}
          title="Toggle chat"
          onClick={() => setChatOpen(!chatOpen.value)}
        >
          จิ
        </button>
      </aside>

      <section class="ob-explorer" aria-label="Explorer">
        <header class="ob-section-head">Explorer</header>
        <div class="ob-explorer-body">
          <PanelHost type="explorer" ctx={ctx} />
        </div>
      </section>

      <main class="ob-main" aria-label="Preview">
        <PanelHost type="preview" ctx={ctx} />
      </main>

      {chatOpen.value && (
        <aside class="ob-chat" aria-label="Chat">
          <header class="ob-section-head">
            Chat · จิโอ้
            <button class="ob-chat-close" title="Hide chat" onClick={() => setChatOpen(false)}>
              ✕
            </button>
          </header>
          <div class="ob-chat-body">
            <p class="ob-chat-stub">
              The agent runtime isn't wired in this build. Chat lands with the
              <code>/api/chat</code> stream (daemon step 2b).
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
