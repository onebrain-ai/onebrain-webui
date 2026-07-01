// contract.ts is pure TypeScript type definitions — no runtime behaviour to
// exercise. This file confirms the module imports cleanly and that the
// structural shape of the exported interfaces is satisfied at compile time
// (the test fails to compile if the shapes diverge, catching regressions).

import { describe, it, expect } from "vitest";
import type { PanelPlacement, PanelContext, PanelDef } from "./contract";

describe("contract — shape smoke-test", () => {
  it("PanelPlacement satisfies its four numeric fields", () => {
    const p: PanelPlacement = { t: 0, y: 1, r: 5, s: 0.005 };
    expect(p.t).toBe(0);
    expect(p.y).toBe(1);
    expect(p.r).toBe(5);
    expect(p.s).toBe(0.005);
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
      placement: { t: 0, y: 0, r: 5, s: 0.005 },
      Component: () => null,
    };
    expect(def.type).toBe("test");
    expect(def.seed).toBeUndefined();

    const seeded: PanelDef = { ...def, seed: true };
    expect(seeded.seed).toBe(true);
  });
});
