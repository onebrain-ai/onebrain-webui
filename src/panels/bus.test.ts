import { describe, it, expect, beforeEach } from "vitest";
import {
  initVault,
  resolveWikilink,
  openFile,
  navBack,
  navForward,
  previewPath,
  navHistory,
  navIndex,
  canNavBack,
  canNavForward,
} from "./bus";

function daemonWith(paths: string[]) {
  return {
    tree: async () => ({
      root: "",
      entries: paths.map((p) => ({ path: p, name: p.split("/").pop()!, kind: "file" as const })),
    }),
  } as unknown as import("../core/daemon").DaemonClient;
}

describe("resolveWikilink — duplicate-name handling", () => {
  it("picks the shortest path for a bare name, and disambiguates a path-qualified one", async () => {
    await initVault(
      daemonWith([
        "README.md",
        "a/b/README.md",
        "01-projects/memmoth/architecture.md",
        "uniq-note.md",
      ]),
    );

    // bare [[README]] → shortest path among duplicates
    expect(resolveWikilink("README")).toBe("README.md");
    // path-qualified targets the exact file
    expect(resolveWikilink("a/b/README")).toBe("a/b/README.md");
    // a partial folder path resolves by suffix
    expect(resolveWikilink("memmoth/architecture")).toBe("01-projects/memmoth/architecture.md");
    // unique name resolves directly; case-insensitive; .md / #heading / |alias stripped
    expect(resolveWikilink("uniq-note")).toBe("uniq-note.md");
    expect(resolveWikilink("UNIQ-NOTE.md")).toBe("uniq-note.md");
    expect(resolveWikilink("uniq-note#section|alias")).toBe("uniq-note.md");
    // unknown → null
    expect(resolveWikilink("does-not-exist")).toBeNull();
  });
});

describe("nav history (back/forward)", () => {
  beforeEach(() => {
    navHistory.value = [];
    navIndex.value = -1;
    previewPath.value = "";
  });

  it("pushes, truncates forward history on a new open, and bounds back/forward", () => {
    openFile("a");
    openFile("b");
    expect(navHistory.value).toEqual(["a", "b"]);
    expect(navIndex.value).toBe(1);
    expect(canNavBack.value).toBe(true);
    expect(canNavForward.value).toBe(false);

    navBack();
    expect(previewPath.value).toBe("a");
    expect(canNavForward.value).toBe(true);

    // opening a new file AFTER going back drops the forward entry "b"
    openFile("c");
    expect(navHistory.value).toEqual(["a", "c"]);
    expect(canNavForward.value).toBe(false);

    // re-opening the current file is a no-op
    openFile("c");
    expect(navHistory.value).toEqual(["a", "c"]);

    // back is bounded at index 0 (no out-of-range previewPath)
    navBack();
    navBack();
    expect(navIndex.value).toBe(0);
    expect(previewPath.value).toBe("a");

    // forward is bounded at the end
    navForward();
    navForward();
    expect(navIndex.value).toBe(1);
    expect(previewPath.value).toBe("c");
  });
});
