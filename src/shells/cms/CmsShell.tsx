import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { DaemonClient } from "../../core/daemon";
import type { PanelContext } from "../../panels/contract";
import { getPanel } from "../../panels";
import { initVault, openFile, previewPath } from "../../panels/bus";
import { setMode, chatOpen, setChatOpen } from "../../core/stores";
import { newNote, newFolder, renameEntry, deleteEntry } from "../../panels/explorer/actions";
import "./cms.css";

/** A 2D panel context: the write-capable daemon, the cross-panel open action,
 *  and a no-op `addPanel` (the CMS has fixed zones, not a free panel arc). */
function ctxFor(daemon: DaemonClient): PanelContext {
  return { daemon, openFile, addPanel: () => {} };
}

const TABS = [
  ["explorer", "Files"],
  ["search", "Search"],
  ["tasks", "Tasks"],
  ["status", "Status"],
] as const;

type SidebarTab = "explorer" | "search" | "tasks" | "status";

export function CmsShell({ daemon }: { daemon: DaemonClient }) {
  const sidebarTab = useSignal<SidebarTab>("explorer");

  useEffect(() => {
    void initVault(daemon);
  }, [daemon]);

  const onNewNote = async () => {
    const p = window.prompt("New note path (e.g. 00-inbox/idea.md)");
    if (p) await newNote(daemon, p, openFile);
  };
  const onNewFolder = async () => {
    const p = window.prompt("New folder path (e.g. 03-knowledge/topic)");
    if (p) await newFolder(daemon, p);
  };
  const onRename = async () => {
    const cur = previewPath.value;
    if (!cur) return;
    const to = window.prompt("Rename / move to", cur);
    if (to && to !== cur) await renameEntry(daemon, cur, to);
  };
  const onDelete = async () => {
    const cur = previewPath.value;
    if (!cur) return;
    await deleteEntry(daemon, cur, false, async (p) => window.confirm(`Move ${p} to .trash/?`));
  };

  const ctx = ctxFor(daemon);
  const SidebarPanel = getPanel(sidebarTab.value)!.Component;
  const Main = getPanel("editor")!.Component;
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
        <button
          class="cms-rail-btn"
          data-testid="cms-chat-toggle"
          title="Chat"
          onClick={() => setChatOpen(!chatOpen.value)}
        >
          💬
        </button>
      </nav>
      <aside class="cms-explorer" data-testid="cms-explorer">
        {sidebarTab.value === "explorer" && (
          <div class="cms-fileops" data-testid="cms-fileops">
            <button data-testid="op-new-note" title="New note" onClick={onNewNote}>＋Note</button>
            <button data-testid="op-new-folder" title="New folder" onClick={onNewFolder}>＋Folder</button>
            <button data-testid="op-rename" title="Rename / move open note" onClick={onRename}>Rename</button>
            <button data-testid="op-delete" title="Delete open note → .trash" onClick={onDelete}>Delete</button>
          </div>
        )}
        <div class="cms-tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              class={sidebarTab.value === id ? "cms-tab is-active" : "cms-tab"}
              data-testid={`cms-tab-${id}`}
              onClick={() => { sidebarTab.value = id; }}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="cms-sidebar-body">
          <SidebarPanel ctx={ctx} />
        </div>
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
