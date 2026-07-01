import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  openSearch,
  searchQuery,
  sidebarTab,
  sidebarCollapsed,
  setSidebarCollapsed,
  setSidebarWidth,
  sidebarWidth,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  setChatOpen,
  chatOpen,
  setChatWidth,
  chatWidth,
  CHAT_MIN,
  CHAT_MAX,
  toggleSidebar,
  propertiesCollapsed,
  togglePropertiesCollapsed,
  accent,
  density,
  theme,
  setAccent,
  setDensity,
  setTheme,
  applyThemeSettings,
  htmlAutorun,
  setHtmlAutorun,
  mediaAutoplay,
  setMediaAutoplay,
  ACCENTS,
} from "./stores";

describe("openSearch", () => {
  beforeEach(() => {
    searchQuery.value = "";
    sidebarTab.value = "explorer";
    setSidebarCollapsed(true);
  });

  it("pre-fills the query, switches to the search tab, and opens the sidebar", () => {
    openSearch("#project");
    expect(searchQuery.value).toBe("#project");
    expect(sidebarTab.value).toBe("search");
    expect(sidebarCollapsed.value).toBe(false);
  });
});

describe("setSidebarWidth", () => {
  it("clamps below the min and above the max", () => {
    setSidebarWidth(10);
    expect(sidebarWidth.value).toBe(SIDEBAR_MIN);
    setSidebarWidth(99999);
    expect(sidebarWidth.value).toBe(SIDEBAR_MAX);
  });
});

describe("toggleSidebar", () => {
  it("flips the collapsed state each call", () => {
    const initial = sidebarCollapsed.value;
    toggleSidebar();
    expect(sidebarCollapsed.value).toBe(!initial);
    toggleSidebar();
    expect(sidebarCollapsed.value).toBe(initial);
  });
});

describe("setChatOpen / chatOpen", () => {
  it("sets the chat open signal", () => {
    setChatOpen(true);
    expect(chatOpen.value).toBe(true);
    setChatOpen(false);
    expect(chatOpen.value).toBe(false);
  });
});

describe("setChatWidth", () => {
  it("clamps below CHAT_MIN and above CHAT_MAX", () => {
    setChatWidth(0);
    expect(chatWidth.value).toBe(CHAT_MIN);
    setChatWidth(99999);
    expect(chatWidth.value).toBe(CHAT_MAX);
  });

  it("accepts a valid value inside the range", () => {
    setChatWidth(500);
    expect(chatWidth.value).toBe(500);
  });
});

describe("propertiesCollapsed / togglePropertiesCollapsed", () => {
  it("toggles the collapsed state", () => {
    const before = propertiesCollapsed.value;
    togglePropertiesCollapsed();
    expect(propertiesCollapsed.value).toBe(!before);
    togglePropertiesCollapsed();
    expect(propertiesCollapsed.value).toBe(before);
  });
});

describe("accent / setAccent", () => {
  it("updates the accent signal to each valid accent", () => {
    for (const name of Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]) {
      setAccent(name);
      expect(accent.value).toBe(name);
    }
  });
});

describe("density / setDensity", () => {
  it("switches between comfortable and compact", () => {
    setDensity("compact");
    expect(density.value).toBe("compact");
    setDensity("comfortable");
    expect(density.value).toBe("comfortable");
  });
});

describe("theme / setTheme", () => {
  it("switches between dark and light", () => {
    setTheme("light");
    expect(theme.value).toBe("light");
    setTheme("dark");
    expect(theme.value).toBe("dark");
  });
});

describe("applyThemeSettings", () => {
  it("runs without error (applies DOM CSS vars from current signals)", () => {
    // Smoke test: verifies the three apply* helpers are reachable.
    expect(() => applyThemeSettings()).not.toThrow();
  });
});

describe("htmlAutorun / setHtmlAutorun", () => {
  it("toggles the autorun flag", () => {
    setHtmlAutorun(true);
    expect(htmlAutorun.value).toBe(true);
    setHtmlAutorun(false);
    expect(htmlAutorun.value).toBe(false);
  });
});

describe("mediaAutoplay / setMediaAutoplay", () => {
  it("toggles the autoplay flag", () => {
    setMediaAutoplay(true);
    expect(mediaAutoplay.value).toBe(true);
    setMediaAutoplay(false);
    expect(mediaAutoplay.value).toBe(false);
  });
});

describe("localStorage helper branches", () => {
  // The jsdom environment may not expose a real localStorage object (it issues a
  // --localstorage-file warning and leaves localStorage undefined). The stores
  // module wraps every access in try/catch for exactly this case (private-mode
  // safety). These tests verify that the catch paths don't break the signals.

  it("signals update normally even when localStorage is unavailable (private-mode sim)", () => {
    // setters go through saveString → localStorage.setItem; if it throws or is
    // absent the module swallows the error. The signal value must still update.
    expect(() => setChatOpen(true)).not.toThrow();
    expect(chatOpen.value).toBe(true);
    expect(() => setSidebarWidth(300)).not.toThrow();
    expect(sidebarWidth.value).toBe(300);
  });

  it("setDensity comfortable branch removes the data-density attribute", () => {
    // Covers the `else removeAttribute` branch in applyDensity.
    setDensity("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    setDensity("comfortable");
    expect(document.documentElement.getAttribute("data-density")).toBeNull();
  });
});

describe("stores — module re-init with localStorage stubs", () => {
  // Re-import the module after seeding localStorage so the module-level
  // ternaries (density/theme/accent) hit their non-default branches.

  it("density initializes to 'compact' when localStorage has that stored value", async () => {
    vi.resetModules();
    // Seed a fake localStorage before the module runs.
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "onebrain.density" ? "compact" : null),
      setItem: vi.fn(),
    });
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?compact");
    expect(mod.density.value).toBe("compact");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("theme initializes to 'light' when localStorage has that stored value", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "onebrain.theme" ? "light" : null),
      setItem: vi.fn(),
    });
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?light");
    expect(mod.theme.value).toBe("light");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loadAccent falls back to 'cyan' when the stored value is not a valid accent", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "onebrain.accent" ? "invalid-accent" : null),
      setItem: vi.fn(),
    });
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?badaccent");
    expect(mod.accent.value).toBe("cyan");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loadAccent uses a valid stored accent (e.g. 'violet')", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "onebrain.accent" ? "violet" : null),
      setItem: vi.fn(),
    });
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?violet");
    expect(mod.accent.value).toBe("violet");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loadString/loadBool/loadNum catch paths: localStorage.getItem throws → use default", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("SecurityError"); },
      setItem: vi.fn(),
    });
    // Module initializes without throwing; signals get their defaults.
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?throws");
    expect(mod.density.value).toBe("comfortable");
    expect(mod.theme.value).toBe("dark");
    expect(mod.accent.value).toBe("cyan");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("saveString catch path: localStorage.setItem throws is swallowed", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new DOMException("SecurityError"); },
    });
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?setthrows");
    // Calling a setter must not throw even when setItem is broken.
    expect(() => mod.setChatOpen(true)).not.toThrow();
    expect(mod.chatOpen.value).toBe(true);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loadNum falls back to dflt for a non-finite stored value", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "onebrain.sidebarWidth" ? "NaN" : null),
      setItem: vi.fn(),
    });
    // @ts-expect-error Vite resolves the ?query suffix; tsc cannot
    const mod = await import("./stores?nanwidth");
    // NaN stored → loadNum returns the dflt (280), then clamp keeps 280.
    expect(mod.sidebarWidth.value).toBe(280);
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
