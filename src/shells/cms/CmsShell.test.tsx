import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { CmsShell } from "./CmsShell";
import { mode, setChatOpen } from "../../core/stores";

vi.mock("../../panels/bus", async (orig) => ({
  ...(await orig<typeof import("../../panels/bus")>()),
  initVault: vi.fn(async () => {}),
}));

const daemon = { tree: vi.fn(async () => ({ root: "", entries: [] })) } as any;

describe("CmsShell", () => {
  it("renders rail, explorer, and main zones", () => {
    render(<CmsShell daemon={daemon} />);
    expect(screen.getByTestId("cms-rail")).toBeTruthy();
    expect(screen.getByTestId("cms-explorer")).toBeTruthy();
    expect(screen.getByTestId("cms-main")).toBeTruthy();
  });

  it("rail mode switch flips to command-center", () => {
    render(<CmsShell daemon={daemon} />);
    fireEvent.click(screen.getByTestId("cms-mode-3d"));
    expect(mode.value).toBe("command-center");
    setChatOpen(false);
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

  it("new-note button creates and opens the note", async () => {
    const createFile = vi.fn(async () => ({ path: "00-inbox/idea.md", rev: "1" }));
    const d = { tree: vi.fn(async () => ({ root: "", entries: [] })), createFile } as any;
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("00-inbox/idea.md");
    render(<CmsShell daemon={d} />);
    fireEvent.click(screen.getByTestId("op-new-note"));
    await waitFor(() => expect(createFile).toHaveBeenCalledWith("00-inbox/idea.md", ""));
    promptSpy.mockRestore();
  });
});
