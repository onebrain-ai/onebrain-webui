import { afterEach } from "vitest";
import { cleanup } from "@testing-library/preact";

// Unmount any component rendered with @testing-library/preact between tests so
// jsdom state doesn't leak across cases.
afterEach(() => cleanup());

// jsdom ships no `CSS` object, but the editor's heading-scroll uses CSS.escape
// to build an id selector. A passthrough is enough for the simple slug ids the
// tests exercise and lets those real code paths run instead of throwing.
if (typeof (globalThis as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
}

// jsdom implements no layout, so Element.scrollIntoView is undefined. Stub a
// no-op so components that scroll to anchors (editor heading-scroll) don't throw;
// tests that assert scrolling still spy on it explicitly.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}
