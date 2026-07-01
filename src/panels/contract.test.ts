// contract.ts is pure TypeScript type definitions — no runtime behaviour to
// exercise. This file confirms the module imports cleanly and that the
// structural shape of the exported interfaces is satisfied at compile time
// (the test fails to compile if the shapes diverge, catching regressions).

import { describe, it, expect } from "vitest";
import type { PanelContext, PanelDef } from "./contract";

describe("contract — shape smoke-test", () => {
  it("PanelDef carries a numeric width field", () => {
    const def: PanelDef = {
      type: "explorer",
      name: "File Explorer",
      width: 280,
      Component: () => null,
    };
    expect(def.width).toBe(280);
    expect(def.name).toBe("File Explorer");
  });

  it("PanelContext carries daemon, openFile, and addPanel", () => {
    const ctx: PanelContext = {
      daemon: {} as PanelContext["daemon"],
      openFile: (path) => { void path; },
      addPanel: (type) => { void type; },
    };
    expect(typeof ctx.openFile).toBe("function");
    expect(typeof ctx.addPanel).toBe("function");
  });

  it("PanelDef carries all required fields and an optional seed flag", () => {
    const def: PanelDef = {
      type: "test",
      name: "Test Panel",
      width: 400,
      Component: () => null,
    };
    expect(def.type).toBe("test");
    expect(def.seed).toBeUndefined();

    const seeded: PanelDef = { ...def, seed: true };
    expect(seeded.seed).toBe(true);
  });
});
