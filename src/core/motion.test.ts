import { describe, it, expect, vi, beforeEach } from "vitest";
import { ambientOn, lowMotion, setAmbient, reduceMotion } from "./motion";

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
  // Reset the signal to the default (ambient on) so tests are independent.
  ambientOn.value = true;
});

describe("reduceMotion", () => {
  it("is a boolean (resolved once at module load)", () => {
    // jsdom's matchMedia returns non-matching, so reduceMotion is false.
    expect(typeof reduceMotion).toBe("boolean");
  });

  it("is true when matchMedia reports reduce-motion preferred (covers the true branch of line 9)", async () => {
    // Stub matchMedia to return matching=true BEFORE the module init runs.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addListener: () => {}, removeListener: () => {} }));
    vi.resetModules();
    const { reduceMotion: rm } = await import("./motion");
    expect(rm).toBe(true);
    vi.unstubAllGlobals();
    vi.resetModules();
    // Restore the localStorage stub that vi.unstubAllGlobals just removed.
    vi.stubGlobal("localStorage", ls);
  });
});

describe("lowMotion()", () => {
  it("returns false when ambient is on and OS reduce-motion is false", () => {
    // lowMotion = reduceMotion || !ambientOn — with jsdom reduceMotion=false.
    ambientOn.value = true;
    expect(lowMotion()).toBe(false);
  });

  it("returns true when ambient is off (regardless of OS setting)", () => {
    ambientOn.value = false;
    expect(lowMotion()).toBe(true);
  });
});

describe("setAmbient()", () => {
  it("turning off sets the signal to false and persists '0'", () => {
    setAmbient(false);
    expect(ambientOn.value).toBe(false);
    expect(ls.getItem("ob-ambient")).toBe("0");
  });

  it("turning on sets the signal to true and persists '1'", () => {
    setAmbient(false); // set to off first
    setAmbient(true);
    expect(ambientOn.value).toBe(true);
    expect(ls.getItem("ob-ambient")).toBe("1");
  });

  it("is non-fatal when localStorage.setItem throws", () => {
    vi.spyOn(ls, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => setAmbient(false)).not.toThrow();
    expect(ambientOn.value).toBe(false); // signal still updated
  });
});

describe("initialAmbient() — storage-backed default", () => {
  it("defaults to ambient on when nothing is stored (signal reset in beforeEach)", () => {
    expect(ambientOn.value).toBe(true);
  });

  it("ambient off round-trips correctly via setAmbient", () => {
    setAmbient(false);
    expect(ambientOn.value).toBe(false);
    expect(ls.getItem("ob-ambient")).toBe("0");
  });

  it("defaults to ambient on when storage is sandboxed (getItem throws — covers the catch)", async () => {
    // Force the module-load read to throw so initialAmbient()'s catch runs.
    // (Node's experimental localStorage throws on some versions but not others,
    // so cover this branch deterministically rather than relying on the host.)
    vi.stubGlobal("localStorage", { ...ls, getItem: () => { throw new DOMException("SecurityError"); } });
    vi.resetModules();
    const { ambientOn: fresh } = await import("./motion");
    expect(fresh.value).toBe(true);
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal("localStorage", ls);
  });
});
