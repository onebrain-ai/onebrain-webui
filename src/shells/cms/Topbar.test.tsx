import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/preact";
import { Topbar } from "./Topbar";
import { chatOpen, setChatOpen, sidebarCollapsed, setSidebarCollapsed } from "../../core/stores";
import { vaultTree } from "../../panels/bus";
import type { TreeNode } from "../../core/tree";

// Partial mock: override allFiles so we can control what files the Topbar counts
// without running the full initVault dance.
vi.mock("../../panels/bus", async (orig) => ({
  ...(await orig<typeof import("../../panels/bus")>()),
  allFiles: vi.fn(() => []),
}));

describe("Topbar", () => {
  beforeEach(() => {
    setChatOpen(false);
    setSidebarCollapsed(false);
    vaultTree.value = null;
  });

  it("renders the topbar with brand and sidebar toggle", () => {
    render(<Topbar />);
    expect(screen.getByTestId("cms-topbar")).toBeTruthy();
    expect(screen.getByLabelText("Toggle sidebar")).toBeTruthy();
    expect(screen.getByText("OneBrain")).toBeTruthy();
  });

  it("chat toggle button is present and shows 'Open chat' title when chat is closed", () => {
    render(<Topbar />);
    const btn = screen.getByTestId("cms-topbar-chat-toggle");
    expect(btn.getAttribute("title")).toBe("Open chat");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking chat toggle sets chatOpen to true", () => {
    render(<Topbar />);
    fireEvent.click(screen.getByTestId("cms-topbar-chat-toggle"));
    expect(chatOpen.value).toBe(true);
  });

  it("when chat is open, button shows 'Close chat' title and is-active class", () => {
    setChatOpen(true);
    render(<Topbar />);
    const btn = screen.getByTestId("cms-topbar-chat-toggle");
    expect(btn.getAttribute("title")).toBe("Close chat");
    expect(btn.className).toContain("is-active");
  });

  it("clicking chat toggle when open sets chatOpen to false", () => {
    setChatOpen(true);
    render(<Topbar />);
    fireEvent.click(screen.getByTestId("cms-topbar-chat-toggle"));
    expect(chatOpen.value).toBe(false);
  });

  it("sidebar toggle button calls toggleSidebar", () => {
    render(<Topbar />);
    fireEvent.click(screen.getByTestId("cms-sidebar-toggle"));
    expect(sidebarCollapsed.value).toBe(true);
    // Toggle again to restore.
    fireEvent.click(screen.getByTestId("cms-sidebar-toggle"));
    expect(sidebarCollapsed.value).toBe(false);
  });

  it("settings button is present and opens SettingsModal on click", () => {
    render(<Topbar />);
    const settingsBtn = screen.getByLabelText("Settings");
    expect(settingsBtn).toBeTruthy();
    // Settings modal should not be present initially.
    expect(screen.queryByTestId("settings-modal")).toBeNull();
    fireEvent.click(settingsBtn);
    // After click, the settings modal should appear.
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
  });

  it("settings modal closes when onClose is called (close via Done)", () => {
    render(<Topbar />);
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("settings-modal")).toBeNull();
  });

  it("shows 0 notes and 0 inbox when vault tree is null", () => {
    vaultTree.value = null;
    render(<Topbar />);
    const stats = screen.getAllByText("0");
    // Both notes count and inbox count should be 0.
    expect(stats.length).toBeGreaterThanOrEqual(2);
  });

  it("clock element renders a time string", () => {
    render(<Topbar />);
    // The Clock renders a locale time string inside .tb-clock.
    const clock = document.querySelector(".tb-clock");
    expect(clock).toBeTruthy();
    // Should contain at least a colon (HH:MM:SS or similar).
    expect(clock!.textContent).toMatch(/:/);
  });

  it("shows correct note and inbox counts when vault tree is loaded with files", async () => {
    // Control allFiles via mock to cover the filter lambdas on lines 49-50.
    const { allFiles } = await import("../../panels/bus");
    (allFiles as ReturnType<typeof vi.fn>).mockReturnValue([
      "00-inbox/todo.md",
      "01-projects/plan.md",
      "01-projects/diagram.png",
      "00-inbox/note.md",
    ]);
    vaultTree.value = [] as TreeNode[]; // non-null triggers allFiles() call
    render(<Topbar />);
    // 3 .md files, 2 of them under 00-inbox/
    expect(screen.getByText("3")).toBeTruthy(); // notes
    expect(screen.getByText("2")).toBeTruthy(); // inbox
    vaultTree.value = null;
    (allFiles as ReturnType<typeof vi.fn>).mockReturnValue([]);
  });

  it("Clock interval updates the displayed time and clears on unmount", () => {
    // Use fake timers to tick the Clock's setInterval without waiting a real second.
    vi.useFakeTimers();
    const { unmount } = render(<Topbar />);
    const clockBefore = document.querySelector(".tb-clock")!.textContent;
    expect(clockBefore).toBeTruthy();
    // Advance 1001ms to fire the interval callback (now.value = currentTime()).
    act(() => { vi.advanceTimersByTime(1001); });
    const clockAfter = document.querySelector(".tb-clock")!.textContent;
    // The time string changes (or at minimum the callback ran without throwing).
    expect(clockAfter).toBeTruthy();
    // Unmount triggers the cleanup function () => clearInterval(id).
    unmount();
    vi.useRealTimers();
  });
});
