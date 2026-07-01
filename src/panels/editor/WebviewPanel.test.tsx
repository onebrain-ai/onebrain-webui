import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/preact";
import { WebviewPanel } from "./WebviewPanel";
import { webviewUrl, webviewOpen, webviewMode } from "./webview-store";

beforeEach(() => {
  webviewOpen.value = true;
  webviewUrl.value = "https://example.com";
  webviewMode.value = "pane";
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
    fireEvent.click(getByLabelText("Back to document"));
    expect(webviewOpen.value).toBe(false);
  });

  it("toggle button switches mode", () => {
    const { getByLabelText } = render(<WebviewPanel />);
    fireEvent.click(getByLabelText("Toggle layout"));
    expect(webviewMode.value).toBe("side");
  });

  it("hang timer falls back to a new tab if the iframe never loads", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WebviewPanel />);
    vi.advanceTimersByTime(8000);
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(webviewOpen.value).toBe(false);
    open.mockRestore();
    vi.useRealTimers();
  });

  it("renders the split layout class when webviewMode is 'side'", () => {
    webviewMode.value = "side";
    const { container } = render(<WebviewPanel />);
    expect(container.querySelector(".ed-webview-side")).toBeTruthy();
  });
});
