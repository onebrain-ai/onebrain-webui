import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchChangelog, latestEntry, type ChangelogData } from "./changelog";

afterEach(() => vi.unstubAllGlobals());

describe("fetchChangelog", () => {
  it("resolves the parsed changelog on a 2xx response", async () => {
    const data: ChangelogData = { latest: "0.1.5", released: "2026-07-01", entries: [] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
    await expect(fetchChangelog()).resolves.toEqual(data);
  });

  it("requests /changelog.json and forwards the abort signal", async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", spy);
    const ac = new AbortController();
    await fetchChangelog(ac.signal);
    expect(spy).toHaveBeenCalledWith("/changelog.json", { signal: ac.signal });
  });

  it("rejects on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchChangelog()).rejects.toThrow(/404/);
  });
});

describe("latestEntry", () => {
  const entry = (version: string, markdown = "x") => ({ version, date: null, markdown });

  it("prefers the entry matching the frontmatter `latest`", () => {
    const d: ChangelogData = {
      latest: "0.1.5",
      released: null,
      entries: [entry("Unreleased", ""), entry("0.1.5"), entry("0.1.4")],
    };
    expect(latestEntry(d)?.version).toBe("0.1.5");
  });

  it("falls back to the first entry with content when none matches `latest`", () => {
    const d: ChangelogData = { latest: "9.9.9", released: null, entries: [entry("0.1.5"), entry("0.1.4")] };
    expect(latestEntry(d)?.version).toBe("0.1.5");
  });

  it("skips a leading empty entry (e.g. an empty Unreleased) rather than showing a blank", () => {
    const d: ChangelogData = {
      latest: null, // no frontmatter match → must skip the empty section by content
      released: null,
      entries: [entry("Unreleased", "   "), entry("0.1.5", "- real change")],
    };
    expect(latestEntry(d)?.version).toBe("0.1.5");
  });

  it("returns null when there are no entries", () => {
    const d: ChangelogData = { latest: null, released: null, entries: [] };
    expect(latestEntry(d)).toBeNull();
  });
});
