import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveToken } from "./token";

// jsdom provides window.location as a special read-only property — we stub it
// with vi.stubGlobal so we can control .search without triggering navigation.
// sessionStorage and localStorage may be undefined in Node 26 scope; stub them.

function makeSessionStorage() {
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

let ss: ReturnType<typeof makeSessionStorage>;

const stubLocation = (search: string, href?: string) =>
  vi.stubGlobal("location", {
    href: href ?? `http://localhost/${search}`,
    search,
    hostname: "localhost",
  });

const stubHistory = () => {
  const replaceState = vi.fn();
  vi.stubGlobal("history", { replaceState });
  return replaceState;
};

beforeEach(() => {
  ss = makeSessionStorage();
  vi.stubGlobal("sessionStorage", ss);
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__ONEBRAIN_TOKEN__;
  // Default: plain URL with no query and no injected global.
  stubLocation("");
  stubHistory();
});

describe("resolveToken — injected global (production path)", () => {
  it("returns the injected token and strips it from the URL", () => {
    (window as unknown as Record<string, unknown>).__ONEBRAIN_TOKEN__ = "prod-tok";
    stubLocation("?token=prod-tok", "http://localhost/?token=prod-tok");
    const replaceState = stubHistory();
    const tok = resolveToken();
    expect(tok).toBe("prod-tok");
    expect(replaceState).toHaveBeenCalled();
  });

  it("ignores the placeholder value (not-yet-injected by daemon)", () => {
    (window as unknown as Record<string, unknown>).__ONEBRAIN_TOKEN__ = "__ONEBRAIN_TOKEN__";
    expect(resolveToken()).toBeNull();
  });

  it("persists the injected token to sessionStorage for subsequent reloads", () => {
    (window as unknown as Record<string, unknown>).__ONEBRAIN_TOKEN__ = "injected-x";
    resolveToken();
    expect(ss.getItem("onebrain.token")).toBe("injected-x");
  });
});

describe("resolveToken — ?token= query (dev path)", () => {
  it("captures a query token, persists it, and strips it from the URL", () => {
    const replaceState = stubHistory();
    stubLocation("?token=dev-tok", "http://localhost/?token=dev-tok");
    const tok = resolveToken();
    expect(tok).toBe("dev-tok");
    expect(ss.getItem("onebrain.token")).toBe("dev-tok");
    expect(replaceState).toHaveBeenCalled();
  });

  it("prefers the injected global over the query param", () => {
    (window as unknown as Record<string, unknown>).__ONEBRAIN_TOKEN__ = "global-tok";
    stubLocation("?token=query-tok", "http://localhost/?token=query-tok");
    expect(resolveToken()).toBe("global-tok");
  });
});

describe("resolveToken — sessionStorage fallback (dev after reload)", () => {
  it("returns a previously-persisted token when no global or query (covers line 51)", () => {
    // This exercises the `return sessionStorage.getItem(STORAGE_KEY)` path directly.
    ss.setItem("onebrain.token", "stored-tok");
    expect(resolveToken()).toBe("stored-tok");
  });

  it("returns null when nothing is available", () => {
    expect(resolveToken()).toBeNull();
  });

  it("returns null when sessionStorage.getItem throws (sandboxed context)", () => {
    vi.spyOn(ss, "getItem").mockImplementation(() => {
      throw new Error("no storage");
    });
    const tok = resolveToken();
    expect(tok).toBeNull();
  });
});

describe("resolveToken — history.replaceState failure is non-fatal", () => {
  it("still returns the token when replaceState throws", () => {
    vi.stubGlobal("history", {
      replaceState: vi.fn(() => {
        throw new Error("SecurityError");
      }),
    });
    stubLocation("?token=safe", "http://localhost/?token=safe");
    expect(resolveToken()).toBe("safe");
  });
});

describe("resolveToken — sessionStorage.setItem failure is non-fatal", () => {
  it("still returns the token even when persist throws", () => {
    vi.spyOn(ss, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    stubLocation("?token=quota-tok", "http://localhost/?token=quota-tok");
    const tok = resolveToken();
    expect(tok).toBe("quota-tok");
  });
});
