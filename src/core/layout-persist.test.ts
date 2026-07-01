import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadLayout, writeLayout, clearLayout, type SavedLayout } from "./layout-persist";

const STORE_KEY = "ob-spatial-layout-v3";

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

const validLayout: SavedLayout = {
  cam: { x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.2 },
  panels: [{ type: "explorer", key: "exp-1", x: 100, y: 200, z: 0, accent: null }],
};

beforeEach(() => {
  ls = makeLocalStorage();
  vi.stubGlobal("localStorage", ls);
  vi.restoreAllMocks();
});

describe("loadLayout()", () => {
  it("returns null when nothing is stored", () => {
    expect(loadLayout()).toBeNull();
  });

  it("returns null for an explicit 'null' stored value", () => {
    ls.setItem(STORE_KEY, "null");
    expect(loadLayout()).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    ls.setItem(STORE_KEY, "{not valid json");
    expect(loadLayout()).toBeNull();
  });

  it("returns null when panels is not an array", () => {
    ls.setItem(STORE_KEY, JSON.stringify({ cam: {}, panels: "bad" }));
    expect(loadLayout()).toBeNull();
  });

  it("returns null when panels is an empty array (empty desk is ignored)", () => {
    ls.setItem(STORE_KEY, JSON.stringify({ cam: {}, panels: [] }));
    expect(loadLayout()).toBeNull();
  });

  it("returns the parsed layout when valid", () => {
    ls.setItem(STORE_KEY, JSON.stringify(validLayout));
    const result = loadLayout();
    expect(result).not.toBeNull();
    expect(result!.panels).toHaveLength(1);
    expect(result!.panels[0].type).toBe("explorer");
    expect(result!.cam.yaw).toBe(0.5);
  });

  it("returns null when localStorage.getItem throws (sandboxed)", () => {
    vi.spyOn(ls, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadLayout()).toBeNull();
  });
});

describe("writeLayout()", () => {
  it("persists a JSON string to localStorage", () => {
    const json = JSON.stringify(validLayout);
    writeLayout(json);
    expect(ls.getItem(STORE_KEY)).toBe(json);
  });

  it("is non-fatal when localStorage.setItem throws", () => {
    vi.spyOn(ls, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => writeLayout('{"x":1}')).not.toThrow();
  });
});

describe("clearLayout()", () => {
  it("removes the key from localStorage", () => {
    ls.setItem(STORE_KEY, JSON.stringify(validLayout));
    clearLayout();
    expect(ls.getItem(STORE_KEY)).toBeNull();
  });

  it("is a no-op (non-fatal) when the key does not exist", () => {
    expect(() => clearLayout()).not.toThrow();
  });

  it("is non-fatal when localStorage.removeItem throws", () => {
    vi.spyOn(ls, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearLayout()).not.toThrow();
  });
});

describe("round-trip: writeLayout → loadLayout", () => {
  it("preserves all fields through the round-trip", () => {
    const layout: SavedLayout = {
      cam: { x: 10, y: -5, z: 2, yaw: 1.2, pitch: 0.3 },
      panels: [
        { type: "preview", key: "prev-1", x: 50, y: 80, z: 1, accent: "magenta" },
        { type: "notes", key: "notes-1", x: 300, y: 100, z: 2, accent: null },
      ],
    };
    writeLayout(JSON.stringify(layout));
    const restored = loadLayout();
    expect(restored).toEqual(layout);
  });
});
