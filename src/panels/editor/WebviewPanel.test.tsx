import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/preact";

// The hang-timer fallback asks via the DS confirm modal before popping a tab.
vi.mock("../../ui/Modal", () => ({ confirmModal: vi.fn() }));
import { confirmModal } from "../../ui/Modal";
const confirmMock = vi.mocked(confirmModal);

import { WebviewPanel } from "./WebviewPanel";
import { webviewUrl, webviewOpen, webviewMode, webviewWidth, setWebviewWidth } from "./webview-store";

beforeEach(() => {
  webviewOpen.value = true;
  webviewUrl.value = "https://example.com";
  webviewMode.value = "pane";
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(false); // default: user cancels the fallback ask
});

describe("WebviewPanel", () => {
  it("renders an iframe pointing at the url with the locked sandbox", () => {
    const { container } = render(<WebviewPanel />);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toBe("https://example.com");
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-popups allow-same-origin",
    );
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("close button returns to the document", () => {
    const { getByLabelText } = render(<WebviewPanel />);
    fireEvent.click(getByLabelText("Close"));
    expect(webviewOpen.value).toBe(false);
  });

  it("toggle button switches mode", () => {
    const { getByLabelText } = render(<WebviewPanel />);
    fireEvent.click(getByLabelText("Toggle layout"));
    expect(webviewMode.value).toBe("side");
  });

  it("hang timer closes the pane and ASKS before opening a new tab; confirm opens it", async () => {
    vi.useFakeTimers();
    confirmMock.mockResolvedValue(true);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WebviewPanel />);
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(webviewOpen.value).toBe(false); // stuck pane closed first
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("https://example.com") }),
    );
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    open.mockRestore();
    vi.useRealTimers();
  });

  it("hang timer's ask does NOT open a tab when the user cancels", async () => {
    vi.useFakeTimers();
    confirmMock.mockResolvedValue(false);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WebviewPanel />);
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(webviewOpen.value).toBe(false);
    expect(confirmMock).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    vi.useRealTimers();
  });

  it("renders the split layout class when webviewMode is 'side'", () => {
    webviewMode.value = "side";
    const { container } = render(<WebviewPanel />);
    expect(container.querySelector(".ed-webview-side")).toBeTruthy();
  });

  it("onLoad clears the hang timer so a slow-but-successful load never opens a new tab", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<WebviewPanel />);
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    vi.advanceTimersByTime(8000);
    expect(open).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(webviewOpen.value).toBe(true);
    open.mockRestore();
    vi.useRealTimers();
  });

  it("unmounting before the hang timer fires clears it (no stray fallback after unmount)", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { unmount } = render(<WebviewPanel />);
    unmount();
    vi.advanceTimersByTime(8000);
    expect(open).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    open.mockRestore();
    vi.useRealTimers();
  });

  it("reload button remounts the iframe (new key) forcing a fresh load", () => {
    const { container, getByLabelText } = render(<WebviewPanel />);
    const before = container.querySelector("iframe")!;
    fireEvent.click(getByLabelText("Reload"));
    const after = container.querySelector("iframe")!;
    expect(after).not.toBe(before);
    expect(after.getAttribute("src")).toBe("https://example.com");
  });

  it("reload re-arms the hang timer so a fresh load still gets fallback protection", async () => {
    vi.useFakeTimers();
    const { getByLabelText, container } = render(<WebviewPanel />);
    // Load the first mount so its timer is cleared, then reload — the remounted
    // iframe must arm its OWN hang timer rather than relying on the cleared one.
    fireEvent.load(container.querySelector("iframe")!);
    fireEvent.click(getByLabelText("Reload"));
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(confirmMock).toHaveBeenCalled(); // fallback ask fired for the remounted frame
    vi.useRealTimers();
  });

  it("does not apply --webview-w style in 'pane' mode", () => {
    webviewMode.value = "pane";
    const { container } = render(<WebviewPanel />);
    const root = container.querySelector(".ed-webview") as HTMLElement;
    expect(root.getAttribute("style")).toBeNull();
  });

  it("applies --webview-w style with the current width in 'side' mode", () => {
    webviewMode.value = "side";
    setWebviewWidth(640);
    const { container } = render(<WebviewPanel />);
    const root = container.querySelector(".ed-webview") as HTMLElement;
    expect(root.style.getPropertyValue("--webview-w")).toBe("640px");
  });

  it("renders the resize handle only in 'side' mode", () => {
    webviewMode.value = "pane";
    const { container, rerender } = render(<WebviewPanel />);
    expect(container.querySelector(".ed-webview-resize")).toBeNull();
    webviewMode.value = "side";
    rerender(<WebviewPanel />);
    expect(container.querySelector(".ed-webview-resize")).toBeTruthy();
  });

  it("resize handle mousedown → mousemove updates webviewWidth from the parent's right edge, mouseup cleans up", () => {
    webviewMode.value = "side";
    const { container } = render(<WebviewPanel />);
    const root = container.querySelector(".ed-webview") as HTMLElement;
    const parent = root.parentElement!;
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      right: 1000,
    } as DOMRect);
    const handle = container.querySelector(".ed-webview-resize") as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0 });
    expect(document.body.classList.contains("ed-webview-resizing")).toBe(true);
    // Cursor at x=600 → width = 1000 (right edge) - 600 = 400.
    fireEvent.mouseMove(document, { clientX: 600 });
    expect(webviewWidth.value).toBe(400);
    fireEvent.mouseUp(document);
    expect(document.body.classList.contains("ed-webview-resizing")).toBe(false);
    // Further mousemove after mouseup must have no effect (listener removed).
    fireEvent.mouseMove(document, { clientX: 900 });
    expect(webviewWidth.value).toBe(400);
  });

  it("back/forward start disabled — the original page has no in-frame history", () => {
    const { container, getByLabelText } = render(<WebviewPanel />);
    fireEvent.load(container.querySelector("iframe")!); // original page
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(true);
  });

  it("in-frame navigation enables Back; clicking it steers the joint history and then enables Forward", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { container, getByLabelText } = render(<WebviewPanel />);
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe); // original page
    fireEvent.load(iframe); // organic in-frame link click → depth 1
    const backBtn = getByLabelText("Page back") as HTMLButtonElement;
    expect(backBtn.disabled).toBe(false);
    fireEvent.click(backBtn);
    expect(back).toHaveBeenCalledTimes(1);
    // While the back navigation is in flight, both buttons are held disabled.
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.load(container.querySelector("iframe")!); // back completed → depth 0, fwd 1
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(false);
    back.mockRestore();
  });

  it("Forward replays the entry, and a fresh organic navigation truncates forward history", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const fwd = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const { container, getByLabelText } = render(<WebviewPanel />);
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe); // original
    fireEvent.load(iframe); // organic → depth 1
    fireEvent.click(getByLabelText("Page back"));
    fireEvent.load(iframe); // depth 0, fwd 1
    fireEvent.click(getByLabelText("Page forward"));
    expect(fwd).toHaveBeenCalledTimes(1);
    fireEvent.load(iframe); // forward completed → depth 1, fwd 0
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(false);
    // Go back again, then navigate organically — the forward entry is truncated.
    fireEvent.click(getByLabelText("Page back"));
    fireEvent.load(iframe); // depth 0, fwd 1
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.load(iframe); // organic click → depth 1, fwd reset to 0
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(true);
    back.mockRestore();
    fwd.mockRestore();
  });

  it("reload resets the in-frame history state (fresh frame, fresh history)", () => {
    const { container, getByLabelText } = render(<WebviewPanel />);
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe); // original
    fireEvent.load(iframe); // organic → depth 1, Back enabled
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByLabelText("Reload"));
    fireEvent.load(container.querySelector("iframe")!); // remounted frame's original page
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("Page forward") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a pending nav that never completes re-enables the buttons after the safety timeout", () => {
    vi.useFakeTimers();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { container, getByLabelText } = render(<WebviewPanel />);
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe); // original (also clears the hang timer)
    fireEvent.load(iframe); // organic → depth 1
    fireEvent.click(getByLabelText("Page back")); // no load ever fires (no-op back)
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2500); // safety valve clears the stuck pending state
    });
    expect((getByLabelText("Page back") as HTMLButtonElement).disabled).toBe(false);
    back.mockRestore();
    vi.useRealTimers();
  });

  it("resize falls back to window.innerWidth when the panel has no parent element", () => {
    webviewMode.value = "side";
    const { container } = render(<WebviewPanel />);
    const root = container.querySelector(".ed-webview") as HTMLElement;
    // Detach from its parent so rootRef.current.parentElement is null, exercising
    // the `?? window.innerWidth` fallback branch.
    root.remove();
    const handle = root.querySelector(".ed-webview-resize") as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 0 });
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(webviewWidth.value).toBe(window.innerWidth - 100);
    fireEvent.mouseUp(document);
  });
});
