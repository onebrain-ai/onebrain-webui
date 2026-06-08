import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
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
});
