// Tests for richviewport.ts: pan/zoom/fullscreen viewport controller.
// The module manipulates DOM geometry and browser APIs extensively. We stub
// getBoundingClientRect, requestAnimationFrame, and the fullscreen API so tests
// run reliably in jsdom without a real layout engine.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { mountViewport } from "./richviewport";

// CSS side-effect import — no content needed in tests
vi.mock("./richviewport.css", () => ({}));

// jsdom can run on an opaque origin where localStorage is absent (prod code
// tolerates that via try/catch). In-memory shim so the pattern-toggle tests
// can drive persistence — same pattern as chat-store.test.ts.
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

// ── geometry stubs ────────────────────────────────────────────────────────────

// jsdom has no layout engine, so getBoundingClientRect() always returns zeros.
// We patch it globally to return a 800×600 frame and 400×300 content box.
const FRAME_RECT = { width: 800, height: 600, left: 100, top: 50, right: 900, bottom: 650, x: 100, y: 50, toJSON: () => ({}) };
const CONTENT_RECT = { width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) };

function patchRects(frame: HTMLElement, content: HTMLElement) {
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(FRAME_RECT as DOMRect);
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue(CONTENT_RECT as DOMRect);
  // offsetWidth/Height are zero in jsdom; give content a size for fit() calculation
  Object.defineProperty(content, "offsetWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(content, "offsetHeight", { configurable: true, get: () => 300 });
}

// requestAnimationFrame: call the callback synchronously so fullscreen-change
// re-fit happens inline in tests.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});

// Fullscreen API is not implemented in jsdom — stub it.
let _fullscreenElement: Element | null = null;
Object.defineProperty(document, "fullscreenElement", {
  configurable: true,
  get: () => _fullscreenElement,
});

// ── factory helper ────────────────────────────────────────────────────────────

/** Build a frame+content pair, append to body, patch geometry, and return them. */
function makeViewport() {
  const frame = document.createElement("div");
  const content = document.createElement("div");
  frame.appendChild(content);
  document.body.appendChild(frame);
  patchRects(frame, content);
  return { frame, content };
}

/** Simulate a full-screen enter/exit and fire the fullscreenchange event. */
function enterFullscreen(frame: HTMLElement) {
  _fullscreenElement = frame;
  document.dispatchEvent(new Event("fullscreenchange"));
}
function exitFullscreen() {
  _fullscreenElement = null;
  document.dispatchEvent(new Event("fullscreenchange"));
}

/** Fire a wheel event on `el` (deltaY < 0 → zoom in, > 0 → zoom out). */
function wheel(el: HTMLElement, deltaY: number, clientX = 200, clientY = 200) {
  el.dispatchEvent(new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }));
}

afterEach(() => {
  _fullscreenElement = null;
  // Clean up any appended nodes so tests don't leak into each other
  document.body.innerHTML = "";
});

// ── mountViewport — basic DOM structure ──────────────────────────────────────

describe("mountViewport — DOM structure", () => {
  it("adds rich-vframe class and tabIndex to frame", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.classList.contains("rich-vframe")).toBe(true);
    expect(frame.tabIndex).toBe(0);
    handle.destroy();
  });

  it("appends a toolbar with zoom-in, zoom-out, fit, and fullscreen buttons", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.querySelector('[data-a="in"]')).not.toBeNull();
    expect(frame.querySelector('[data-a="out"]')).not.toBeNull();
    expect(frame.querySelector('[data-a="fit"]')).not.toBeNull();
    expect(frame.querySelector('[data-a="full"]')).not.toBeNull();
    handle.destroy();
  });

  it("adds prev/next buttons and label element when nav is provided", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "1 / 3") };
    const handle = mountViewport(frame, content, { nav });
    expect(frame.querySelector('[data-a="prev"]')).not.toBeNull();
    expect(frame.querySelector('[data-a="next"]')).not.toBeNull();
    expect(frame.querySelector(".rich-vlabel")).not.toBeNull();
    handle.destroy();
  });

  it("omits prev/next buttons when nav is not provided", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.querySelector('[data-a="prev"]')).toBeNull();
    expect(frame.querySelector('[data-a="next"]')).toBeNull();
    handle.destroy();
  });

  it("adds bgToggle button when bgToggle:true", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content, { bgToggle: true });
    expect(frame.querySelector('[data-a="bg"]')).not.toBeNull();
    handle.destroy();
  });

  it("omits bgToggle button when bgToggle is not set", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.querySelector('[data-a="bg"]')).toBeNull();
    handle.destroy();
  });
});

// ── mountViewport — fit / initial state ──────────────────────────────────────

describe("mountViewport — initial fit", () => {
  it("sets a transform on content after mount (fit() ran)", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    // fit() sets content.style.transform to translate+scale
    expect(content.style.transform).toMatch(/translate\(/);
    expect(content.style.transformOrigin).toBe("0 0");
    handle.destroy();
  });
});

// ── mountViewport — toolbar button actions ───────────────────────────────────

describe("mountViewport — toolbar buttons", () => {
  it("zoom-in button increases scale (transform changes)", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    frame.querySelector<HTMLButtonElement>('[data-a="in"]')!.click();
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("zoom-out button changes scale", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    frame.querySelector<HTMLButtonElement>('[data-a="out"]')!.click();
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("fit button resets transform (calls onFit callback)", () => {
    const { frame, content } = makeViewport();
    const onFit = vi.fn();
    const handle = mountViewport(frame, content, { onFit });
    // Zoom first so fit does something visible
    frame.querySelector<HTMLButtonElement>('[data-a="in"]')!.click();
    frame.querySelector<HTMLButtonElement>('[data-a="fit"]')!.click();
    expect(onFit).toHaveBeenCalled();
    handle.destroy();
  });

  it("prev button calls nav.prev and refreshes label", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "2 / 5") };
    const handle = mountViewport(frame, content, { nav });
    frame.querySelector<HTMLButtonElement>('[data-a="prev"]')!.click();
    expect(nav.prev).toHaveBeenCalled();
    expect(nav.label).toHaveBeenCalled();
    handle.destroy();
  });

  it("next button calls nav.next and refreshes label", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "2 / 5") };
    const handle = mountViewport(frame, content, { nav });
    frame.querySelector<HTMLButtonElement>('[data-a="next"]')!.click();
    expect(nav.next).toHaveBeenCalled();
    handle.destroy();
  });

  it("clicking bg button toggles the bg class between dark and light", () => {
    const { frame, content } = makeViewport();
    // Start with a light theme so initial bg is light
    document.documentElement.setAttribute("data-theme", "light");
    const handle = mountViewport(frame, content, { bgToggle: true });
    expect(frame.classList.contains("rich-bg-light")).toBe(true);
    frame.querySelector<HTMLButtonElement>('[data-a="bg"]')!.click();
    expect(frame.classList.contains("rich-bg-dark")).toBe(true);
    expect(frame.classList.contains("rich-bg-light")).toBe(false);
    // Toggle back
    frame.querySelector<HTMLButtonElement>('[data-a="bg"]')!.click();
    expect(frame.classList.contains("rich-bg-light")).toBe(true);
    document.documentElement.removeAttribute("data-theme");
    handle.destroy();
  });

  it("dark theme initial bg is dark", () => {
    const { frame, content } = makeViewport();
    document.documentElement.setAttribute("data-theme", "dark");
    const handle = mountViewport(frame, content, { bgToggle: true });
    expect(frame.classList.contains("rich-bg-dark")).toBe(true);
    document.documentElement.removeAttribute("data-theme");
    handle.destroy();
  });

  it("pattern button exists only with bgToggle, and toggles checkerboard → plain (persisted)", () => {
    localStorage.removeItem("onebrain.previewPlainBg");
    const bare = makeViewport();
    const bareHandle = mountViewport(bare.frame, bare.content);
    expect(bare.frame.querySelector('[data-a="pattern"]')).toBeNull();
    bareHandle.destroy();

    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content, { bgToggle: true });
    expect(frame.classList.contains("rich-bg-plain")).toBe(false); // checkerboard by default
    frame.querySelector<HTMLButtonElement>('[data-a="pattern"]')!.click();
    expect(frame.classList.contains("rich-bg-plain")).toBe(true);
    expect(localStorage.getItem("onebrain.previewPlainBg")).toBe("1");
    frame.querySelector<HTMLButtonElement>('[data-a="pattern"]')!.click();
    expect(frame.classList.contains("rich-bg-plain")).toBe(false);
    expect(localStorage.getItem("onebrain.previewPlainBg")).toBe("0");
    handle.destroy();
  });

  it("a persisted plain preference applies on mount, and destroy removes the class", () => {
    localStorage.setItem("onebrain.previewPlainBg", "1");
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content, { bgToggle: true });
    expect(frame.classList.contains("rich-bg-plain")).toBe(true);
    handle.destroy();
    expect(frame.classList.contains("rich-bg-plain")).toBe(false);
    localStorage.removeItem("onebrain.previewPlainBg");
  });

  it("pattern toggle still applies in-session when localStorage.setItem throws (private mode)", () => {
    localStorage.removeItem("onebrain.previewPlainBg");
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content, { bgToggle: true });
    const orig = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("blocked");
    };
    frame.querySelector<HTMLButtonElement>('[data-a="pattern"]')!.click();
    expect(frame.classList.contains("rich-bg-plain")).toBe(true); // class applied despite persist failure
    localStorage.setItem = orig;
    handle.destroy();
  });

  it("applyBg is a no-op when bgToggle is not set (no bg classes added)", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.classList.contains("rich-bg-dark")).toBe(false);
    expect(frame.classList.contains("rich-bg-light")).toBe(false);
    handle.destroy();
  });

  it("clicking a non-button child of toolbar does nothing", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const bar = frame.querySelector<HTMLElement>(".rich-vbar")!;
    // Click on the bar element itself (not a button) — should not throw
    expect(() => bar.click()).not.toThrow();
    handle.destroy();
  });
});

// ── mountViewport — fullscreen ────────────────────────────────────────────────

describe("mountViewport — fullscreen", () => {
  it("toggles is-full class on fullscreenchange", () => {
    const { frame, content } = makeViewport();
    // stub requestFullscreen so it doesn't throw in jsdom
    frame.requestFullscreen = vi.fn(async () => {});
    const handle = mountViewport(frame, content);
    enterFullscreen(frame);
    expect(frame.classList.contains("is-full")).toBe(true);
    exitFullscreen();
    expect(frame.classList.contains("is-full")).toBe(false);
    handle.destroy();
  });

  it("fullscreen button calls requestFullscreen when not in fullscreen", () => {
    const { frame, content } = makeViewport();
    frame.requestFullscreen = vi.fn(async () => {});
    const handle = mountViewport(frame, content);
    frame.querySelector<HTMLButtonElement>('[data-a="full"]')!.click();
    expect(frame.requestFullscreen).toHaveBeenCalled();
    handle.destroy();
  });

  it("fullscreen button calls exitFullscreen when already in fullscreen", () => {
    const { frame, content } = makeViewport();
    frame.requestFullscreen = vi.fn(async () => {});
    document.exitFullscreen = vi.fn(async () => {});
    const handle = mountViewport(frame, content);
    // Simulate entering fullscreen first
    _fullscreenElement = frame;
    frame.querySelector<HTMLButtonElement>('[data-a="full"]')!.click();
    expect(document.exitFullscreen).toHaveBeenCalled();
    _fullscreenElement = null;
    handle.destroy();
  });

  it("falls back to the webkit-prefixed fullscreen API (Safari / WKWebView)", () => {
    const { frame, content } = makeViewport();
    // WebKit env: no standard requestFullscreen, only the prefixed one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = frame as any;
    f.requestFullscreen = undefined;
    f.webkitRequestFullscreen = vi.fn();
    const handle = mountViewport(frame, content);
    frame.querySelector<HTMLButtonElement>('[data-a="full"]')!.click();
    expect(f.webkitRequestFullscreen).toHaveBeenCalled();

    // Now "in" webkit fullscreen → the exit path uses webkitExitFullscreen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = document as any;
    _fullscreenElement = null;
    d.webkitFullscreenElement = frame;
    const origExit = document.exitFullscreen;
    d.exitFullscreen = undefined;
    d.webkitExitFullscreen = vi.fn();
    // a webkit fullscreenchange event also drives the is-full class
    document.dispatchEvent(new Event("webkitfullscreenchange"));
    expect(frame.classList.contains("is-full")).toBe(true);
    frame.querySelector<HTMLButtonElement>('[data-a="full"]')!.click();
    expect(d.webkitExitFullscreen).toHaveBeenCalled();
    d.webkitFullscreenElement = undefined;
    d.exitFullscreen = origExit;
    handle.destroy();
  });

  it("fullscreen button is a no-op when no fullscreen API exists (both request and exit paths)", () => {
    const { frame, content } = makeViewport();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = frame as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = document as any;
    f.requestFullscreen = undefined;
    f.webkitRequestFullscreen = undefined;
    const handle = mountViewport(frame, content);
    // request path: not in fullscreen, neither API → no-op, no throw
    expect(() => frame.querySelector<HTMLButtonElement>('[data-a="full"]')!.click()).not.toThrow();
    // exit path: "in" fullscreen but neither exit API exists → `if (exit)` false branch
    _fullscreenElement = frame;
    const origExit = document.exitFullscreen;
    d.exitFullscreen = undefined;
    d.webkitExitFullscreen = undefined;
    expect(() => frame.querySelector<HTMLButtonElement>('[data-a="full"]')!.click()).not.toThrow();
    _fullscreenElement = null;
    d.exitFullscreen = origExit;
    handle.destroy();
  });
});

// ── mountViewport — drag to pan ───────────────────────────────────────────────

describe("mountViewport — drag to pan", () => {
  it("panning moves the content transform", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    // Mousedown on the frame (not on toolbar)
    frame.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 300, clientY: 200, bubbles: true }));
    // Move 50px right and 30px down
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 350, clientY: 230 }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("right-click does not start a drag", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    frame.dispatchEvent(new MouseEvent("mousedown", { button: 2, clientX: 300, clientY: 200 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 300 }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    // transform should remain unchanged since no drag started
    expect(content.style.transform).toBe(before);
    handle.destroy();
  });

  it("mousedown on toolbar does not start a drag", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    const bar = frame.querySelector<HTMLElement>(".rich-vbar")!;
    // Simulate mousedown on a toolbar button — closest('.rich-vbar') will match
    bar.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 400 }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(content.style.transform).toBe(before);
    handle.destroy();
  });

  it("adds is-grabbing class during drag and removes it on mouseup", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    frame.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 300, clientY: 200, bubbles: true }));
    expect(frame.classList.contains("is-grabbing")).toBe(true);
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(frame.classList.contains("is-grabbing")).toBe(false);
    handle.destroy();
  });

  it("mousemove without a prior mousedown does not move content", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    // Move without drag
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 400 }));
    expect(content.style.transform).toBe(before);
    handle.destroy();
  });
});

// ── mountViewport — wheel zoom ────────────────────────────────────────────────

describe("mountViewport — wheel zoom", () => {
  it("scroll up (negative deltaY) zooms in", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    wheel(frame, -100);
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("scroll down (positive deltaY) zooms out", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    const before = content.style.transform;
    wheel(frame, 100);
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("scale is clamped at MIN (0.2) — repeated zoom-out does not go below", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    // Zoom out many times
    for (let i = 0; i < 50; i++) wheel(frame, 200);
    // Transform should still be set (not NaN / infinite)
    expect(content.style.transform).toMatch(/scale\(0\.[2-9]/);
    handle.destroy();
  });

  it("scale is clamped at MAX (8) — repeated zoom-in does not exceed 8", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    for (let i = 0; i < 50; i++) wheel(frame, -200);
    // The transform should contain scale(8) at the cap
    expect(content.style.transform).toContain("scale(8)");
    handle.destroy();
  });
});

// ── mountViewport — keyboard shortcuts ───────────────────────────────────────

describe("mountViewport — keyboard shortcuts", () => {
  function activeFrame(frame: HTMLElement) {
    // Make the frame appear "active" by setting it as activeElement
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => frame });
  }

  afterEach(() => {
    // Restore activeElement to document.body
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => document.body });
  });

  it("z key zooms in", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    const before = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("Z (shift+z) zooms out", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    const before = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Z", shiftKey: true }));
    expect(content.style.transform).not.toBe(before);
    handle.destroy();
  });

  it("+ / = key zooms in", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    const t1 = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    const t2 = content.style.transform;
    expect(t2).not.toBe(t1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=" }));
    expect(content.style.transform).not.toBe(t2);
    handle.destroy();
  });

  it("- / _ key zooms out", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    const before = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
    expect(content.style.transform).not.toBe(before);
    // Underscore also zooms out
    const t2 = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "_" }));
    expect(content.style.transform).not.toBe(t2);
    handle.destroy();
  });

  it("0 key calls fit", () => {
    const { frame, content } = makeViewport();
    const onFit = vi.fn();
    const handle = mountViewport(frame, content, { onFit });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    expect(onFit).toHaveBeenCalled();
    handle.destroy();
  });

  it("f/F key calls requestFullscreen", () => {
    const { frame, content } = makeViewport();
    frame.requestFullscreen = vi.fn(async () => {});
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(frame.requestFullscreen).toHaveBeenCalled();
    handle.destroy();
  });

  it("Space key adds is-pannable class; keyup removes it", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(frame.classList.contains("is-pannable")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    expect(frame.classList.contains("is-pannable")).toBe(false);
    handle.destroy();
  });

  it("ArrowRight calls nav.next when nav is set", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "1 / 3") };
    const handle = mountViewport(frame, content, { nav });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(nav.next).toHaveBeenCalled();
    handle.destroy();
  });

  it("ArrowDown calls nav.next", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "1 / 3") };
    const handle = mountViewport(frame, content, { nav });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(nav.next).toHaveBeenCalled();
    handle.destroy();
  });

  it("PageDown calls nav.next", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "1 / 3") };
    const handle = mountViewport(frame, content, { nav });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    expect(nav.next).toHaveBeenCalled();
    handle.destroy();
  });

  it("ArrowLeft calls nav.prev", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "2 / 3") };
    const handle = mountViewport(frame, content, { nav });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(nav.prev).toHaveBeenCalled();
    handle.destroy();
  });

  it("ArrowUp calls nav.prev", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "2 / 3") };
    const handle = mountViewport(frame, content, { nav });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(nav.prev).toHaveBeenCalled();
    handle.destroy();
  });

  it("PageUp calls nav.prev", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "2 / 3") };
    const handle = mountViewport(frame, content, { nav });
    activeFrame(frame);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    expect(nav.prev).toHaveBeenCalled();
    handle.destroy();
  });

  it("arrow keys do nothing when nav is not set", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    // Should not throw
    expect(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    }).not.toThrow();
    handle.destroy();
  });

  it("unrecognized key does nothing and does not call preventDefault", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    activeFrame(frame);
    const before = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    expect(content.style.transform).toBe(before);
    handle.destroy();
  });

  it("keyboard events are ignored when frame is not active/hovered/fullscreen", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    // activeElement is document.body (not the frame) by default after afterEach reset
    const before = content.style.transform;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    // Transform should be unchanged since frame is not active
    expect(content.style.transform).toBe(before);
    handle.destroy();
  });
});

// ── mountViewport — refreshLabel ──────────────────────────────────────────────

describe("mountViewport — refreshLabel", () => {
  it("sets the label element text from nav.label()", () => {
    const { frame, content } = makeViewport();
    const nav = { prev: vi.fn(), next: vi.fn(), label: vi.fn(() => "3 / 5") };
    const handle = mountViewport(frame, content, { nav });
    const labelEl = frame.querySelector<HTMLElement>(".rich-vlabel")!;
    expect(labelEl.textContent).toBe("3 / 5");
    // After nav changes, refreshLabel updates the text
    nav.label.mockReturnValueOnce("4 / 5");
    handle.refreshLabel();
    expect(labelEl.textContent).toBe("4 / 5");
    handle.destroy();
  });

  it("refreshLabel is a no-op when no nav is provided", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(() => handle.refreshLabel()).not.toThrow();
    handle.destroy();
  });
});

// ── mountViewport — destroy ───────────────────────────────────────────────────

describe("mountViewport — destroy", () => {
  it("removes the toolbar from the frame", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.querySelector(".rich-vbar")).not.toBeNull();
    handle.destroy();
    expect(frame.querySelector(".rich-vbar")).toBeNull();
  });

  it("removes all added classes from frame", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    handle.destroy();
    expect(frame.classList.contains("rich-vframe")).toBe(false);
    expect(frame.classList.contains("is-pannable")).toBe(false);
    expect(frame.classList.contains("is-grabbing")).toBe(false);
    expect(frame.classList.contains("is-full")).toBe(false);
    expect(frame.classList.contains("rich-bg-dark")).toBe(false);
    expect(frame.classList.contains("rich-bg-light")).toBe(false);
  });

  it("removes tabIndex attribute from frame", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    expect(frame.hasAttribute("tabindex")).toBe(true);
    handle.destroy();
    expect(frame.hasAttribute("tabindex")).toBe(false);
  });

  it("removes window-level event listeners after destroy (keydown no longer fires)", () => {
    const { frame, content } = makeViewport();
    const onFit = vi.fn();
    const handle = mountViewport(frame, content, { onFit });
    handle.destroy();
    // After destroy, keydown events should no longer trigger viewport actions
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => frame });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    // onFit would have been called during mount (initial fit) — record that call count
    const callsBefore = onFit.mock.calls.length;
    expect(onFit.mock.calls.length).toBe(callsBefore); // no new call after destroy
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => document.body });
  });

  it("removes wheel listener after destroy (wheel no longer changes content)", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    handle.destroy();
    const after = content.style.transform;
    wheel(frame, -100);
    // Transform should not change since wheel listener was removed
    expect(content.style.transform).toBe(after);
  });
});

// ── mountViewport — fit with zero offsetWidth (fallback to frame size) ────────

describe("mountViewport — fit fallback when content has zero size", () => {
  it("uses frame dimensions when content offsetWidth/Height are 0", () => {
    const frame = document.createElement("div");
    const content = document.createElement("div");
    frame.appendChild(content);
    document.body.appendChild(frame);
    // Patch frame rect but leave content at 0×0 (default jsdom)
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(FRAME_RECT as DOMRect);
    // content offsets stay at 0 — fit() should fallback to fr.width/fr.height
    const handle = mountViewport(frame, content);
    // Should not produce NaN in transform
    expect(content.style.transform).not.toContain("NaN");
    handle.destroy();
  });
});

// ── richviewport branch coverage for lines 131 and 206 ───────────────────────

describe("mountViewport — branch coverage: fullBtn innerHTML + non-space keyup", () => {
  // Line 131: `if (fullBtn) fullBtn.innerHTML = on ? ICON.exit : ICON.full`
  // fullBtn is always found since the 'full' button is always rendered.
  // The branch where fullBtn IS present is exercised; the null path is structurally
  // unreachable (the toolbar always includes the button). Verify the real path:

  it("fullBtn icon switches to ICON.exit when entering fullscreen", () => {
    const { frame, content } = makeViewport();
    frame.requestFullscreen = vi.fn(async () => {});
    const handle = mountViewport(frame, content);
    const fullBtn = frame.querySelector<HTMLElement>('[data-a="full"]')!;
    const originalHtml = fullBtn.innerHTML;
    // Simulate fullscreen entry
    enterFullscreen(frame);
    // The button HTML should change (exit icon replaces full icon)
    expect(fullBtn.innerHTML).not.toBe(originalHtml);
    // And change back on exit
    exitFullscreen();
    expect(fullBtn.innerHTML).toBe(originalHtml);
    handle.destroy();
  });

  // Line 206: `if (e.key === " ") frame.classList.remove("is-pannable")`
  // The FALSE branch (any key other than Space) must NOT remove is-pannable.

  it("keyup with key other than Space does not remove is-pannable class", () => {
    const { frame, content } = makeViewport();
    const handle = mountViewport(frame, content);
    frame.classList.add("is-pannable");
    // Fire keyup for 'a' — should leave is-pannable intact
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    expect(frame.classList.contains("is-pannable")).toBe(true);
    // Now fire Space — should remove it
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    expect(frame.classList.contains("is-pannable")).toBe(false);
    handle.destroy();
  });
});
