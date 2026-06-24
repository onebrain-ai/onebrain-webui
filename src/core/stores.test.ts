import { describe, it, expect, beforeEach } from "vitest";
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
