import { describe, it, expect, vi, beforeEach } from "vitest";
import { panelAccent, setStoredPanelAccent } from "./panel-accent";
import { ACCENT_HEX } from "./accent";

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
  // Clear the in-memory panelAccents map by removing all known keys via the public API.
  for (const key of Object.keys(ACCENT_HEX)) {
    setStoredPanelAccent(`widget-${key}`, null);
  }
  for (const k of ["myWidget", "other", "w1", "w2", "badWidget", "neverSet"]) {
    setStoredPanelAccent(k, null);
  }
});

describe("panelAccent()", () => {
  it("returns null for an unknown widget (nothing stored)", () => {
    expect(panelAccent("neverSet")).toBeNull();
  });

  it("returns the accent key after it has been set", () => {
    setStoredPanelAccent("myWidget", "violet");
    expect(panelAccent("myWidget")).toBe("violet");
  });

  it("returns null when the stored value is not a valid ACCENT_HEX key", () => {
    // The guard `a && ACCENT_HEX[a]` in panelAccent returns null for invalid stored values.
    setStoredPanelAccent("badWidget", "not-a-real-accent");
    expect(panelAccent("badWidget")).toBeNull();
  });
});

describe("setStoredPanelAccent()", () => {
  it("pins a valid accent and persists to localStorage", () => {
    setStoredPanelAccent("myWidget", "magenta");
    expect(panelAccent("myWidget")).toBe("magenta");
    const stored = JSON.parse(ls.getItem("ob-spatial-panel-accents")!);
    expect(stored["myWidget"]).toBe("magenta");
  });

  it("clearing (null) removes the entry and updates localStorage", () => {
    setStoredPanelAccent("myWidget", "amber");
    setStoredPanelAccent("myWidget", null);
    expect(panelAccent("myWidget")).toBeNull();
    const stored = JSON.parse(ls.getItem("ob-spatial-panel-accents")!);
    expect(stored["myWidget"]).toBeUndefined();
  });

  it("is a no-op for an invalid accent key (the guard deletes rather than pins)", () => {
    setStoredPanelAccent("myWidget", "cyan"); // valid baseline
    setStoredPanelAccent("myWidget", "neon"); // truthy but not in ACCENT_HEX → delete branch
    expect(panelAccent("myWidget")).toBeNull();
  });

  it("setting multiple widgets persists all of them", () => {
    setStoredPanelAccent("w1", "cyan");
    setStoredPanelAccent("w2", "lime");
    expect(panelAccent("w1")).toBe("cyan");
    expect(panelAccent("w2")).toBe("lime");
    const stored = JSON.parse(ls.getItem("ob-spatial-panel-accents")!);
    expect(stored["w1"]).toBe("cyan");
    expect(stored["w2"]).toBe("lime");
  });

  it("is non-fatal when localStorage.setItem throws", () => {
    vi.spyOn(ls, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => setStoredPanelAccent("myWidget", "grey")).not.toThrow();
  });
});

describe("load() — module-level init reads from storage (covers lines 12-13)", () => {
  it("reads a stored panel-accents map when the module is freshly imported", async () => {
    // Pre-seed storage BEFORE the module runs load() at import time.
    const preLs = makeLocalStorage();
    preLs.setItem("ob-spatial-panel-accents", JSON.stringify({ "myWidget": "cyan" }));
    vi.stubGlobal("localStorage", preLs);
    vi.resetModules();
    const { panelAccent: freshPanelAccent } = await import("./panel-accent");
    expect(freshPanelAccent("myWidget")).toBe("cyan");
    // Restore for subsequent tests.
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });

  it("falls back to empty map when stored JSON is not an object (covers non-object branch)", async () => {
    const preLs = makeLocalStorage();
    preLs.setItem("ob-spatial-panel-accents", JSON.stringify(null));
    vi.stubGlobal("localStorage", preLs);
    vi.resetModules();
    const { panelAccent: freshPanelAccent } = await import("./panel-accent");
    expect(freshPanelAccent("any")).toBeNull();
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });

  it("uses '{}' fallback when nothing is stored (covers '|| \"{}\"' branch on line 12)", async () => {
    // localStorage IS available but the key is absent → getItem returns null → uses "{}".
    const preLs = makeLocalStorage(); // empty — no key stored
    vi.stubGlobal("localStorage", preLs);
    vi.resetModules();
    const { panelAccent: freshPanelAccent } = await import("./panel-accent");
    expect(freshPanelAccent("any")).toBeNull(); // empty map → null for any key
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });

  it("falls back to empty map when the stored value is malformed JSON (covers the catch)", async () => {
    // getItem returns invalid JSON → JSON.parse throws → load()'s catch returns {}.
    // (Covers line 15 deterministically regardless of the host's localStorage behaviour.)
    const preLs = makeLocalStorage();
    preLs.setItem("ob-spatial-panel-accents", "{not valid json");
    vi.stubGlobal("localStorage", preLs);
    vi.resetModules();
    const { panelAccent: freshPanelAccent } = await import("./panel-accent");
    expect(freshPanelAccent("any")).toBeNull();
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });
});
