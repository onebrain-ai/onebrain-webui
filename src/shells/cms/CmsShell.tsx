import { useEffect } from "preact/hooks";
import type { DaemonClient } from "../../core/daemon";
import type { PanelContext } from "../../panels/contract";
import { getPanel } from "../../panels";
import { initVault, openFile, previewPath, loadConfig } from "../../panels/bus";
import {
  chatOpen,
  sidebarWidth,
  sidebarCollapsed,
  setSidebarWidth,
  setSidebarCollapsed,
  chatWidth,
  setChatWidth,
  sidebarTab,
  type SidebarTab,
} from "../../core/stores";
import { newNote, newFolder, renameEntry, deleteEntry } from "../../panels/explorer/actions";
import { loadTasks } from "../../panels/tasks-store";
import { editorBridge } from "../../core/editor-bridge";
import { Icon, type IconName } from "../../ui/Icon";
import { promptModal, confirmModal, ModalHost } from "../../ui/Modal";
import { TaskModalHost } from "../../panels/tasks/task-modal";
import { Topbar } from "./Topbar";
import { ConflictToast } from "./ConflictToast";
import "./cms.css";

/** A 2D panel context: the write-capable daemon, the cross-panel open action,
 *  and a no-op `addPanel` (the CMS has fixed zones, not a free panel arc). */
function ctxFor(daemon: DaemonClient): PanelContext {
  // addPanel is a no-op: the CMS uses fixed layout zones, not a free panel arc.
  return { daemon, openFile, addPanel: /* v8 ignore next */ () => {} };
}

/** Left activity rail: each entry selects which panel fills the sidebar. */
const NAV: ReadonlyArray<readonly [SidebarTab, IconName, string]> = [
  ["explorer", "file", "Files"],
  ["search", "search", "Search"],
  ["tasks", "tasks", "Tasks"],
  ["memory", "book", "Memory"],
  ["status", "activity", "Status"],
] as const;

/** Rail width (px) — used to convert a drag x-coordinate into a sidebar width. */
const RAIL_W = 52;

export function CmsShell({ daemon }: { daemon: DaemonClient }) {
  useEffect(() => {
    void initVault(daemon);
    void loadTasks(daemon);
    void loadConfig(daemon);
  }, [daemon]);

  // Re-scan the vault when the window regains focus, so files/folders created in
  // Obsidian or the shell show up without a reload. (Manual refresh button too.)
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      // Debounce: a focus storm (alt-tabbing) shouldn't fire a tree+tasks+config
      // refetch each time. One refresh per 10s is plenty for "files changed externally".
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      void initVault(daemon);
      void loadTasks(daemon);
      void loadConfig(daemon);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [daemon]);

  const onRefresh = () => {
    void initVault(daemon);
    void loadTasks(daemon);
    void loadConfig(daemon);
  };

  const onNewNote = async () => {
    const p = await promptModal({ title: "New note", placeholder: "00-inbox/idea.md", okLabel: "Create" });
    if (p) await newNote(daemon, p, openFile);
  };
  const onNewFolder = async () => {
    const p = await promptModal({ title: "New folder", placeholder: "03-knowledge/topic", okLabel: "Create" });
    if (p) await newFolder(daemon, p);
  };
  const onRename = async () => {
    const cur = previewPath.value;
    if (!cur) return;
    const to = await promptModal({ title: "Rename / move", value: cur, okLabel: "Rename" });
    if (to && to !== cur) await renameEntry(daemon, cur, to);
  };
  const onDelete = async () => {
    const cur = previewPath.value;
    if (!cur) return;
    await deleteEntry(daemon, cur, false, (p) =>
      confirmModal({ title: "Move to trash?", message: `Move ${p} to .trash/?`, okLabel: "Delete", danger: true }),
    );
  };

  // Rail click = VS-Code activity-bar behaviour: click a different tab → open it;
  // click the ACTIVE tab → collapse; click anything while collapsed → re-open it.
  const onNav = (id: SidebarTab) => {
    if (sidebarCollapsed.value) {
      setSidebarCollapsed(false);
      sidebarTab.value = id;
    } else if (sidebarTab.value === id) {
      setSidebarCollapsed(true);
    } else {
      sidebarTab.value = id;
    }
  };

  // Drag the sidebar's right edge to resize. Listeners live on document so the
  // drag keeps tracking even when the cursor outruns the thin handle.
  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setSidebarWidth(ev.clientX - RAIL_W);
    const stop = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      document.body.classList.remove("cms-resizing");
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    document.body.classList.add("cms-resizing");
  };

  // Drag the chat dock's LEFT edge to resize it (it's pinned to the right edge,
  // so its width = viewport-width minus the cursor x).
  const startChatResize = (e: MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => setChatWidth(window.innerWidth - ev.clientX);
    const stop = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      document.body.classList.remove("cms-resizing");
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    document.body.classList.add("cms-resizing");
  };

  const ctx = ctxFor(daemon);
  const collapsed = sidebarCollapsed.value;
  const SidebarPanel = getPanel(sidebarTab.value)!.Component;
  const Main = getPanel("editor")!.Component;
  const Chat = getPanel("chat")!.Component;

  return (
    <div
      class="cms"
      data-testid="cms-shell"
      data-chat={chatOpen.value ? "open" : "closed"}
      data-sidebar={collapsed ? "collapsed" : "open"}
      style={`--sidebar-w:${collapsed ? 0 : sidebarWidth.value}px;--chat-w:${chatWidth.value}px`}
    >
      <Topbar />

      <nav class="cms-rail" data-testid="cms-rail">
        {NAV.filter(([id]) => id !== "status").map(([id, icon, label]) => (
          <button
            key={id}
            class={sidebarTab.value === id && !collapsed ? "cms-rail-btn is-active" : "cms-rail-btn"}
            type="button"
            data-testid={`cms-tab-${id}`}
            title={label}
            aria-label={label}
            onClick={() => onNav(id)}
          >
            <Icon name={icon} />
          </button>
        ))}
        <div class="cms-rail-grow" />
        {/* System sits at the bottom of the rail (where the chat toggle used to
            be, before it moved to the topbar) — a meta/status anchor. */}
        {NAV.filter(([id]) => id === "status").map(([id, icon, label]) => (
          <button
            key={id}
            class={sidebarTab.value === id && !collapsed ? "cms-rail-btn is-active" : "cms-rail-btn"}
            type="button"
            data-testid={`cms-tab-${id}`}
            title={label}
            aria-label={label}
            onClick={() => onNav(id)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </nav>

      <aside class="cms-explorer" data-testid="cms-explorer">
        {sidebarTab.value === "explorer" && (
          <div class="cms-fileops" data-testid="cms-fileops">
            <button type="button" class="fo-btn" data-testid="op-new-note" title="New note" aria-label="New note" onClick={onNewNote}>
              <Icon name="file-plus" />
            </button>
            <button type="button" class="fo-btn" data-testid="op-new-folder" title="New folder" aria-label="New folder" onClick={onNewFolder}>
              <Icon name="folder-plus" />
            </button>
            <span class="fo-sep" />
            <button type="button" class="fo-btn" data-testid="op-rename" title="Rename / move open note" aria-label="Rename" onClick={onRename}>
              <Icon name="edit" />
            </button>
            <button type="button" class="fo-btn fo-danger" data-testid="op-delete" title="Delete open note → .trash" aria-label="Delete" onClick={onDelete}>
              <Icon name="trash" />
            </button>
            <span class="fo-sep" />
            <button type="button" class="fo-btn" data-testid="op-refresh" title="Refresh vault" aria-label="Refresh vault" onClick={onRefresh}>
              <Icon name="refresh" />
            </button>
          </div>
        )}
        <div class="cms-sidebar-body">
          <SidebarPanel ctx={ctx} />
        </div>
        <div class="cms-resize" onMouseDown={startResize} title="Drag to resize" />
      </aside>

      <main class="cms-main" data-testid="cms-main">
        <Main ctx={ctx} />
      </main>

      {chatOpen.value && (
        <aside class="cms-chat" data-testid="cms-chat">
          <div class="cms-chat-resize" onMouseDown={startChatResize} title="Drag to resize" />
          <Chat ctx={ctx} />
        </aside>
      )}

      <ConflictToast
        onReload={() => { void editorBridge.value?.reload(); }}
        onOverwrite={() => { void editorBridge.value?.overwrite(); }}
      />
      <ModalHost />
      <TaskModalHost />
    </div>
  );
}
