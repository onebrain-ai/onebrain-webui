import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/preact";
import { CmsShell } from "./CmsShell";
import {
  setChatOpen,
  sidebarTab,
  sidebarCollapsed,
  setSidebarCollapsed,
  sidebarWidth,
  chatWidth,
} from "../../core/stores";
import { previewPath } from "../../panels/bus";
import { editorBridge } from "../../core/editor-bridge";
import { saveStatus } from "../../core/autosave";

vi.mock("../../panels/bus", async (orig) => ({
  ...(await orig<typeof import("../../panels/bus")>()),
  initVault: vi.fn(async () => {}),
}));

// Minimal daemon stub — covers tree (vault init) + file (editor mount).
const daemon = {
  tree: vi.fn(async () => ({ root: "", entries: [] })),
  file: vi.fn(async () => ({ content: "", rev: "0" })),
} as any;

describe("CmsShell", () => {
  // sidebarTab is a module-level signal now — reset it so tab-switching in one
  // test doesn't hide the explorer (and its file-ops) in the next.
  beforeEach(() => {
    sidebarTab.value = "explorer";
    sidebarCollapsed.value = false;
    previewPath.value = "";
    setChatOpen(false);
  });

  it("renders rail, explorer, and main zones", () => {
    render(<CmsShell daemon={daemon} />);
    expect(screen.getByTestId("cms-rail")).toBeTruthy();
    expect(screen.getByTestId("cms-explorer")).toBeTruthy();
    expect(screen.getByTestId("cms-main")).toBeTruthy();
  });

  it("switches the sidebar tab to Search", () => {
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("cms-tab-search"));
    expect(screen.getByTestId("cms-tab-search").className).toContain("is-active");
  });

  it("mounts the chat panel when chatOpen is set", () => {
    setChatOpen(true);
    render(<CmsShell daemon={daemon} />);
    expect(screen.getByTestId("cms-chat")).toBeTruthy();
    setChatOpen(false);
  });

  it("new-note button opens the DS modal, then creates and opens the note", async () => {
    const createFile = vi.fn(async () => ({ path: "00-inbox/idea.md", rev: "1" }));
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), createFile } as any;
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-new-note"));
    // The DS modal (not window.prompt) collects the path.
    const modal = await screen.findByTestId("ob-modal");
    const input = modal.querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "00-inbox/idea.md" } });
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await waitFor(() => expect(createFile).toHaveBeenCalledWith("00-inbox/idea.md", ""));
  });

  it("new-note modal cancelled (Cancel button) → createFile not called", async () => {
    const createFile = vi.fn();
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), createFile } as any;
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-new-note"));
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("ob-modal")).toBeNull());
    expect(createFile).not.toHaveBeenCalled();
  });

  it("new-folder button opens modal and calls createFolder on confirm", async () => {
    const createFolder = vi.fn(async () => {});
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), createFolder } as any;
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-new-folder"));
    const modal = await screen.findByTestId("ob-modal");
    const input = modal.querySelector("input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "03-knowledge/topic" } });
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith("03-knowledge/topic"));
  });

  it("new-folder modal cancelled → createFolder not called", async () => {
    const createFolder = vi.fn();
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), createFolder } as any;
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-new-folder"));
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("ob-modal")).toBeNull());
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("rename button opens modal pre-filled with current path and calls moveFile", async () => {
    const moveFile = vi.fn(async () => {});
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), file: vi.fn(async () => ({ content: "", rev: "0" })), moveFile } as any;
    // Set a file so onRename has a cur path.
    previewPath.value = "00-inbox/note.md";
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-rename"));
    const modal = await screen.findByTestId("ob-modal");
    const input = modal.querySelector("input") as HTMLInputElement;
    // Change the value to a different path so the rename fires.
    fireEvent.input(input, { target: { value: "01-projects/note.md" } });
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await waitFor(() => expect(moveFile).toHaveBeenCalledWith("00-inbox/note.md", "01-projects/note.md"));
  });

  it("rename with same value as current → moveFile not called", async () => {
    const moveFile = vi.fn();
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), file: vi.fn(async () => ({ content: "", rev: "0" })), moveFile } as any;
    previewPath.value = "00-inbox/note.md";
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-rename"));
    const modal = await screen.findByTestId("ob-modal");
    const input = modal.querySelector("input") as HTMLInputElement;
    // Leave the value unchanged (same as cur) → rename should not fire.
    fireEvent.input(input, { target: { value: "00-inbox/note.md" } });
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await waitFor(() => expect(screen.queryByTestId("ob-modal")).toBeNull());
    expect(moveFile).not.toHaveBeenCalled();
  });

  it("rename button with no open file → no modal opens", async () => {
    previewPath.value = "";
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("op-rename"));
    // Modal should not appear when there is no current file.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("ob-modal")).toBeNull();
  });

  it("delete button opens confirm modal and calls deleteFile on confirm", async () => {
    const deleteFile = vi.fn(async () => {});
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), file: vi.fn(async () => ({ content: "", rev: "0" })), deleteFile } as any;
    previewPath.value = "00-inbox/note.md";
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-delete"));
    // confirmModal shows the OK button labelled per `okLabel`.
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByTestId("ob-modal-ok"));
    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith("00-inbox/note.md"));
  });

  it("delete confirm cancelled → deleteFile not called", async () => {
    const deleteFile = vi.fn();
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), file: vi.fn(async () => ({ content: "", rev: "0" })), deleteFile } as any;
    previewPath.value = "00-inbox/note.md";
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-delete"));
    await screen.findByTestId("ob-modal");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("ob-modal")).toBeNull());
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("delete button with no open file → no modal opens", async () => {
    previewPath.value = "";
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("op-delete"));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("ob-modal")).toBeNull();
  });

  it("refresh button calls initVault again", async () => {
    const { initVault } = await import("../../panels/bus");
    const mockInitVault = initVault as ReturnType<typeof vi.fn>;
    mockInitVault.mockClear();
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("op-refresh"));
    // initVault is called at mount + once more for refresh.
    await waitFor(() => expect(mockInitVault).toHaveBeenCalledTimes(2));
  });

  it("clicking active tab collapses the sidebar (onNav: active → collapse)", () => {
    render(<CmsShell daemon={daemon} />);
    // explorer tab is already active; clicking it again should collapse.
    fireEvent.click(screen.getByTestId("cms-tab-explorer"));
    expect(sidebarCollapsed.value).toBe(true);
    // restore
    sidebarCollapsed.value = false;
  });

  it("clicking any tab while collapsed expands + switches to that tab", () => {
    sidebarCollapsed.value = true;
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("cms-tab-search"));
    expect(sidebarCollapsed.value).toBe(false);
    expect(sidebarTab.value).toBe("search");
  });

  it("sidebar resize handle fires setSidebarWidth on mousemove then cleans up on mouseup", () => {
    render(<CmsShell daemon={daemon} />);
    const handle = document.querySelector(".cms-resize") as HTMLElement;
    // Arm the drag.
    fireEvent.mouseDown(handle, { clientX: 0 });
    expect(document.body.classList.contains("cms-resizing")).toBe(true);
    // Drag the sidebar to 400px from the viewport left edge (400 - RAIL_W=52 = 348).
    fireEvent.mouseMove(document, { clientX: 400 });
    expect(sidebarWidth.value).toBe(348);
    // Release — listeners removed, class gone.
    fireEvent.mouseUp(document);
    expect(document.body.classList.contains("cms-resizing")).toBe(false);
  });

  it("chat resize handle fires setChatWidth on mousemove then cleans up", () => {
    setChatOpen(true);
    render(<CmsShell daemon={daemon} />);
    const handle = document.querySelector(".cms-chat-resize") as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0 });
    expect(document.body.classList.contains("cms-resizing")).toBe(true);
    // window.innerWidth is 1024 in jsdom by default; cursor at x=724 → width=300.
    fireEvent.mouseMove(document, { clientX: 724 });
    // width = 1024 - 724 = 300, which equals CHAT_MIN so it is clamped there.
    expect(chatWidth.value).toBe(300);
    fireEvent.mouseUp(document);
    expect(document.body.classList.contains("cms-resizing")).toBe(false);
  });

  it("window focus after >10 s triggers a vault refresh", async () => {
    const { initVault } = await import("../../panels/bus");
    const mockInitVault = initVault as ReturnType<typeof vi.fn>;
    mockInitVault.mockClear();
    // Fake Date so the debounce thinks enough time has passed.
    const spy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)       // mount call sets last=0
      .mockReturnValue(15_000);     // focus fires at t=15000 → 15000-0 >= 10000
    render(<CmsShell daemon={daemon} />);
    // Flush mount effect (first initVault call sets last internally via closure).
    await act(async () => {});
    mockInitVault.mockClear();
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mockInitVault).toHaveBeenCalled());
    spy.mockRestore();
  });

  it("window focus within 10 s debounce does NOT trigger a vault refresh", async () => {
    const { initVault } = await import("../../panels/bus");
    const mockInitVault = initVault as ReturnType<typeof vi.fn>;
    // Everything at t=0 → now - last = 0, below threshold.
    vi.spyOn(Date, "now").mockReturnValue(0);
    render(<CmsShell daemon={daemon} />);
    await act(async () => {});
    mockInitVault.mockClear();
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockInitVault).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("file-ops toolbar is hidden when a non-explorer tab is active", () => {
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("cms-tab-search"));
    expect(screen.queryByTestId("cms-fileops")).toBeNull();
  });

  it("status tab at bottom of rail is also clickable", () => {
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("cms-tab-status"));
    expect(sidebarTab.value).toBe("status");
  });

  it("ConflictToast onReload callback fires editorBridge.reload()", async () => {
    // Wire up a mock bridge so the onReload arrow actually calls through.
    const reload = vi.fn(async () => {});
    editorBridge.value = { reload, overwrite: vi.fn(async () => {}) };
    saveStatus.value = "conflict";
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByText(/Reload/));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    editorBridge.value = null;
    saveStatus.value = "idle";
  });

  it("ConflictToast onOverwrite callback fires editorBridge.overwrite()", async () => {
    const overwrite = vi.fn(async () => {});
    editorBridge.value = { overwrite, reload: vi.fn(async () => {}) };
    saveStatus.value = "conflict";
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByText(/Overwrite/));
    await waitFor(() => expect(overwrite).toHaveBeenCalled());
    editorBridge.value = null;
    saveStatus.value = "idle";
  });
});
