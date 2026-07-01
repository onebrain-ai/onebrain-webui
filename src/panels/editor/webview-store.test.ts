import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  webviewOpen, webviewUrl, webviewMode, webviewNotice,
  openExternalLink, closeWebview, toggleWebviewMode,
} from "./webview-store";

// jsdom runs on an opaque origin here, so the real localStorage is absent (prod
// code tolerates that via try/catch). Install a minimal in-memory shim so the
// test can actually seed + drive persistence, matching chat-store.test.ts.
beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  }
});

beforeEach(() => {
  localStorage.clear();
  closeWebview();
  webviewMode.value = "pane";
  webviewNotice.value = null;
});

describe("openExternalLink", () => {
  it("opens the panel when the url is frameable", async () => {
    const daemon = { webviewPreflight: vi.fn().mockResolvedValue(true) };
    await openExternalLink("https://example.com", daemon);
    expect(webviewOpen.value).toBe(true);
    expect(webviewUrl.value).toBe("https://example.com");
  });

  it("falls back to a new tab (no panel) when not frameable", async () => {
    const daemon = { webviewPreflight: vi.fn().mockResolvedValue(false) };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalLink("https://github.com", daemon);
    expect(webviewOpen.value).toBe(false);
    expect(open).toHaveBeenCalledWith("https://github.com", "_blank", "noopener,noreferrer");
    expect(webviewNotice.value).toBeTruthy();
    open.mockRestore();
  });

  it("falls back to a new tab when preflight throws", async () => {
    const daemon = { webviewPreflight: vi.fn().mockRejectedValue(new Error("net")) };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalLink("https://x.example", daemon);
    expect(webviewOpen.value).toBe(false);
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("mode", () => {
  it("toggles and persists to localStorage", () => {
    expect(webviewMode.value).toBe("pane");
    toggleWebviewMode();
    expect(webviewMode.value).toBe("side");
    expect(localStorage.getItem("onebrain.webviewMode")).toBe("side");
  });
});
