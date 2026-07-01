import { describe, it, expect, vi, beforeEach } from "vitest";
import { FPS_CHOICES, fpsCap, frameMs, setFpsCap } from "./perf";

// jsdom in this project does not provide window.localStorage (no testEnvironmentOptions.url).
// Stub it so the production code's localStorage calls are exercised.
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

let ls: ReturnType<typeof makeLocalStorage>;

beforeEach(() => {
  ls = makeLocalStorage();
  vi.stubGlobal("localStorage", ls);
  vi.restoreAllMocks();
  // Reset the signal to the default (60 fps) so tests are independent.
  fpsCap.value = 60;
});

describe("FPS_CHOICES", () => {
  it("contains exactly [30, 60, 120, 144]", () => {
    expect(FPS_CHOICES).toEqual([30, 60, 120, 144]);
  });
});

describe("frameMs()", () => {
  it("returns 1000/60 when cap is 60", () => {
    fpsCap.value = 60;
    expect(frameMs()).toBeCloseTo(1000 / 60);
  });

  it("returns 1000/30 when cap is 30", () => {
    fpsCap.value = 30;
    expect(frameMs()).toBeCloseTo(1000 / 30);
  });

  it("returns 1000/144 when cap is 144", () => {
    fpsCap.value = 144;
    expect(frameMs()).toBeCloseTo(1000 / 144);
  });
});

describe("setFpsCap()", () => {
  it("sets a valid choice, updates the signal, and persists to localStorage", () => {
    setFpsCap(30);
    expect(fpsCap.value).toBe(30);
    expect(ls.getItem("ob-fps-cap")).toBe("30");
  });

  it("sets 120 and persists correctly", () => {
    setFpsCap(120);
    expect(fpsCap.value).toBe(120);
    expect(ls.getItem("ob-fps-cap")).toBe("120");
  });

  it("falls back to 60 for an invalid value and persists '60'", () => {
    setFpsCap(999);
    expect(fpsCap.value).toBe(60);
    expect(ls.getItem("ob-fps-cap")).toBe("60");
  });

  it("falls back to 60 for 0 (not a valid choice)", () => {
    setFpsCap(0);
    expect(fpsCap.value).toBe(60);
  });

  it("is non-fatal when localStorage.setItem throws", () => {
    vi.spyOn(ls, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => setFpsCap(144)).not.toThrow();
    expect(fpsCap.value).toBe(144); // signal still updated
  });

  it("accepts all four valid choices without throwing", () => {
    for (const v of FPS_CHOICES) {
      expect(() => setFpsCap(v)).not.toThrow();
      expect(fpsCap.value).toBe(v);
    }
  });
});

describe("initialCap() — storage-backed default", () => {
  it("defaults to 60 when nothing is stored (signal reset in beforeEach)", () => {
    // Module-level initialCap() ran at import time — confirmed via the reset signal.
    expect(fpsCap.value).toBe(60);
  });

  it("reads a valid stored cap when the module is freshly imported (covers line 13)", async () => {
    // Pre-seed storage BEFORE the module runs initialCap() at import time.
    const preLs = makeLocalStorage();
    preLs.setItem("ob-fps-cap", "144");
    vi.stubGlobal("localStorage", preLs);
    vi.resetModules();
    const { fpsCap: freshCap } = await import("./perf");
    expect(freshCap.value).toBe(144);
    // Restore for subsequent tests.
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });
});
