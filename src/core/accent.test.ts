import { describe, it, expect, vi, beforeEach } from "vitest";
import { ACCENT_HEX, ACCENT_KEYS, accentName, setAccent, initAccent } from "./accent";

// jsdom in this project does not provide window.localStorage (no testEnvironmentOptions.url
// is set). Stub it with a simple in-memory Map so production code's localStorage
// calls are exercised rather than swallowed by their try/catch guards.
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
  accentName.value = "cyan";
  document.documentElement.style.removeProperty("--section-accent");
});

describe("ACCENT_HEX / ACCENT_KEYS", () => {
  it("exports exactly six named accents", () => {
    expect(ACCENT_KEYS).toHaveLength(6);
    expect(ACCENT_KEYS).toContain("cyan");
  });

  it("each key maps to a hex string", () => {
    for (const k of ACCENT_KEYS) {
      expect(ACCENT_HEX[k]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("setAccent()", () => {
  it("updates the signal, sets the CSS var, and persists to localStorage", () => {
    setAccent("magenta");
    expect(accentName.value).toBe("magenta");
    expect(document.documentElement.style.getPropertyValue("--section-accent")).toBe(ACCENT_HEX.magenta);
    expect(ls.getItem("ob-spatial-accent")).toBe("magenta");
  });

  it("is a no-op for an unknown accent name", () => {
    accentName.value = "cyan";
    setAccent("neon-pink");
    expect(accentName.value).toBe("cyan"); // unchanged
    expect(ls.getItem("ob-spatial-accent")).toBeNull();
  });

  it("applies every known accent without throwing", () => {
    for (const k of ACCENT_KEYS) {
      expect(() => setAccent(k)).not.toThrow();
      expect(accentName.value).toBe(k);
    }
  });

  it("is non-fatal when localStorage.setItem throws", () => {
    vi.spyOn(ls, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => setAccent("amber")).not.toThrow();
    expect(accentName.value).toBe("amber"); // signal still updated
  });
});

describe("initAccent()", () => {
  it("writes the CSS var for the currently active accent (boot sync)", () => {
    accentName.value = "lime";
    document.documentElement.style.removeProperty("--section-accent");
    initAccent();
    expect(document.documentElement.style.getPropertyValue("--section-accent")).toBe(ACCENT_HEX.lime);
  });
});

describe("initialAccent() — storage-backed default", () => {
  it("initialises accentName to 'cyan' when nothing is stored (signal reset in beforeEach)", () => {
    expect(accentName.value).toBe("cyan");
  });

  it("setAccent persists the choice and the signal matches", () => {
    setAccent("grey");
    expect(ls.getItem("ob-spatial-accent")).toBe("grey");
    expect(accentName.value).toBe("grey");
  });

  it("reads a valid stored accent key when the module is freshly imported (covers line 27)", async () => {
    // Pre-seed storage BEFORE the module runs initialAccent() at import time.
    const preLs = makeLocalStorage();
    preLs.setItem("ob-spatial-accent", "violet");
    vi.stubGlobal("localStorage", preLs);
    vi.resetModules();
    const { accentName: freshName } = await import("./accent");
    expect(freshName.value).toBe("violet");
    // Restore the per-test stub for subsequent tests.
    vi.stubGlobal("localStorage", ls);
    vi.resetModules();
  });
});
