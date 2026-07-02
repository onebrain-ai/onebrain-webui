import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// The fallback path asks via the DS confirm modal before popping a new tab —
// mock it so tests control the user's answer without rendering ModalHost.
vi.mock("../../ui/Modal", () => ({ confirmModal: vi.fn() }));
import { confirmModal } from "../../ui/Modal";
const confirmMock = vi.mocked(confirmModal);

import {
  webviewOpen, webviewUrl, webviewMode, webviewWidth,
  openExternalLink, closeWebview, toggleWebviewMode, setWebviewWidth,
  WEBVIEW_MIN, WEBVIEW_MAX,
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
  confirmMock.mockReset();
});

describe("openExternalLink", () => {
  it("opens the panel when the url is frameable", async () => {
    const daemon = { webviewPreflight: vi.fn().mockResolvedValue(true) };
    await openExternalLink("https://example.com", daemon);
    expect(webviewOpen.value).toBe(true);
    expect(webviewUrl.value).toBe("https://example.com");
  });

  it("asks first when not frameable, and opens the tab on confirm", async () => {
    confirmMock.mockResolvedValue(true);
    const daemon = { webviewPreflight: vi.fn().mockResolvedValue(false) };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalLink("https://github.com", daemon);
    expect(webviewOpen.value).toBe(false);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("https://github.com") }),
    );
    expect(open).toHaveBeenCalledWith("https://github.com", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("does NOT open a tab when the user cancels the confirm", async () => {
    confirmMock.mockResolvedValue(false);
    const daemon = { webviewPreflight: vi.fn().mockResolvedValue(false) };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalLink("https://github.com", daemon);
    expect(confirmMock).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(webviewOpen.value).toBe(false);
    open.mockRestore();
  });

  it("asks + opens on confirm when preflight throws", async () => {
    confirmMock.mockResolvedValue(true);
    const daemon = { webviewPreflight: vi.fn().mockRejectedValue(new Error("net")) };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalLink("https://x.example", daemon);
    expect(webviewOpen.value).toBe(false);
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });

  it("applies only the latest of two overlapping calls when the first resolves last", async () => {
    // Click A, then click B while A's preflight is still in flight. A resolves
    // LAST — without sequencing it would win and clobber B's (correct, latest) url.
    let releaseA!: (v: boolean) => void;
    const aPromise = new Promise<boolean>((res) => { releaseA = res; });
    const daemon = {
      webviewPreflight: vi.fn()
        .mockImplementationOnce(() => aPromise) // click A: deferred
        .mockImplementationOnce(async () => true), // click B: resolves immediately
    };
    const first = openExternalLink("https://a.example", daemon);
    const second = openExternalLink("https://b.example", daemon);
    await second; // B resolves first
    expect(webviewUrl.value).toBe("https://b.example");
    releaseA(true); // now let A resolve, superseded
    await first;
    expect(webviewUrl.value).toBe("https://b.example"); // still B — A's stale result dropped
  });

  it("a preflight resolving after closeWebview() does not resurrect the panel", async () => {
    let release!: (v: boolean) => void;
    const promise = new Promise<boolean>((res) => { release = res; });
    const daemon = { webviewPreflight: vi.fn().mockImplementation(() => promise) };
    const pending = openExternalLink("https://example.com", daemon);
    closeWebview(); // invalidate the in-flight request before it resolves
    release(true);
    await pending;
    expect(webviewOpen.value).toBe(false);
  });
});


describe("mode", () => {
  it("toggles and persists to localStorage", () => {
    expect(webviewMode.value).toBe("pane");
    toggleWebviewMode();
    expect(webviewMode.value).toBe("side");
    expect(localStorage.getItem("onebrain.webviewMode")).toBe("side");
  });

  it("toggles back from 'side' to 'pane'", () => {
    toggleWebviewMode();
    expect(webviewMode.value).toBe("side");
    toggleWebviewMode();
    expect(webviewMode.value).toBe("pane");
    expect(localStorage.getItem("onebrain.webviewMode")).toBe("pane");
  });

  it("loadMode() reads a stored 'side' value when the module is freshly imported (covers line 13)", async () => {
    // Pre-seed storage BEFORE the module runs loadMode() at import time.
    localStorage.setItem("onebrain.webviewMode", "side");
    vi.resetModules();
    const { webviewMode: freshMode } = await import("./webview-store");
    expect(freshMode.value).toBe("side");
    // Restore for subsequent tests.
    localStorage.clear();
    vi.resetModules();
  });

  it("loadMode() defaults to 'pane' on a fresh import when nothing is stored", async () => {
    localStorage.clear();
    vi.resetModules();
    const { webviewMode: freshMode } = await import("./webview-store");
    expect(freshMode.value).toBe("pane");
    vi.resetModules();
  });
});

describe("setWebviewWidth", () => {
  it("clamps a value below WEBVIEW_MIN up to the minimum", () => {
    setWebviewWidth(100);
    expect(webviewWidth.value).toBe(WEBVIEW_MIN);
  });

  it("clamps a value above WEBVIEW_MAX down to the maximum", () => {
    setWebviewWidth(2000);
    expect(webviewWidth.value).toBe(WEBVIEW_MAX);
  });

  it("passes through and rounds a mid-range value", () => {
    setWebviewWidth(800.6);
    expect(webviewWidth.value).toBe(801);
  });

  it("persists the clamped/rounded value to localStorage", () => {
    setWebviewWidth(900);
    expect(localStorage.getItem("onebrain.webviewWidth")).toBe("900");
  });

  it("loadWidth() reads a stored value when the module is freshly imported", async () => {
    localStorage.setItem("onebrain.webviewWidth", "500");
    vi.resetModules();
    const { webviewWidth: freshWidth } = await import("./webview-store");
    expect(freshWidth.value).toBe(500);
    localStorage.clear();
    vi.resetModules();
  });

  it("loadWidth() defaults to 720 on a fresh import when nothing is stored", async () => {
    localStorage.clear();
    vi.resetModules();
    const { webviewWidth: freshWidth } = await import("./webview-store");
    expect(freshWidth.value).toBe(720);
    vi.resetModules();
  });

  it("loadWidth() defaults to 720 when the stored value is not a positive number", async () => {
    localStorage.setItem("onebrain.webviewWidth", "not-a-number");
    vi.resetModules();
    const { webviewWidth: freshWidth } = await import("./webview-store");
    expect(freshWidth.value).toBe(720);
    localStorage.clear();
    vi.resetModules();
  });
});
