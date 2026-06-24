import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { CmsShell } from "./CmsShell";
import { setChatOpen, sidebarTab } from "../../core/stores";

vi.mock("../../panels/bus", async (orig) => ({
  ...(await orig<typeof import("../../panels/bus")>()),
  initVault: vi.fn(async () => {}),
}));

const daemon = { tree: vi.fn(async () => ({ root: "", entries: [] })) } as any;

describe("CmsShell", () => {
  // sidebarTab is a module-level signal now — reset it so tab-switching in one
  // test doesn't hide the explorer (and its file-ops) in the next.
  beforeEach(() => {
    sidebarTab.value = "explorer";
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
});
