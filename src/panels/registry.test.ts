// registry.ts keeps module-level state (_registry + _order). Each test must
// work with a fresh module to avoid ordering side-effects between cases —
// that's why we vi.resetModules() + dynamic-import in every test.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PanelDef } from "./contract";

function stubDef(type: string, seed?: boolean): PanelDef {
  return {
    type,
    name: type,
    width: 300,
    seed,
    Component: () => null,
  };
}

describe("registerPanel / getPanel / allPanels / seedPanels", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers a panel and retrieves it by type", async () => {
    const { registerPanel, getPanel } = await import("./registry");
    registerPanel(stubDef("chat"));
    expect(getPanel("chat")?.type).toBe("chat");
  });

  it("returns undefined for an unregistered type", async () => {
    const { getPanel } = await import("./registry");
    expect(getPanel("missing")).toBeUndefined();
  });

  it("allPanels returns panels in registration order", async () => {
    const { registerPanel, allPanels } = await import("./registry");
    registerPanel(stubDef("explorer"));
    registerPanel(stubDef("chat"));
    registerPanel(stubDef("tasks"));
    expect(allPanels().map((p) => p.type)).toEqual(["explorer", "chat", "tasks"]);
  });

  it("seedPanels filters to only seed:true entries", async () => {
    const { registerPanel, seedPanels } = await import("./registry");
    registerPanel(stubDef("explorer", true));
    registerPanel(stubDef("chat", false));
    registerPanel(stubDef("tasks", true));
    registerPanel(stubDef("preview")); // seed undefined → not seeded
    const seeds = seedPanels().map((p) => p.type);
    expect(seeds).toEqual(["explorer", "tasks"]);
  });

  it("re-registration (hot-reload): last def wins, order unchanged, DEV warning emitted", async () => {
    // import.meta.env.DEV is resolved at build time by Vite and cannot be changed at
    // runtime — vi.stubGlobal("import", ...) has no effect on it. The spy below simply
    // captures whatever warn call registerPanel makes (always fires in the test build).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registerPanel, getPanel, allPanels } = await import("./registry");

    registerPanel(stubDef("chat"));
    registerPanel({ ...stubDef("chat"), name: "Chat v2" }); // re-register same type

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"chat"'));
    // last registration's name wins
    expect(getPanel("chat")?.name).toBe("Chat v2");
    // only one entry in the order list
    expect(allPanels().filter((p) => p.type === "chat")).toHaveLength(1);
    warn.mockRestore();
  });

  it("re-registration: last def wins regardless of DEV mode", async () => {
    // import.meta.env.DEV is a compile-time constant injected by Vite — it cannot
    // be toggled at runtime. The test here verifies the common observable behavior:
    // the last registration always wins (regardless of whether a warning is emitted).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registerPanel, getPanel } = await import("./registry");

    registerPanel(stubDef("tasks"));
    registerPanel({ ...stubDef("tasks"), name: "Tasks v2" });

    // Last def wins — that is what matters for consumers.
    expect(getPanel("tasks")?.name).toBe("Tasks v2");
    warn.mockRestore();
  });
});
