import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initVault,
  loadConfig,
  resolveWikilink,
  resolveAsset,
  openFile,
  navBack,
  navForward,
  previewPath,
  navHistory,
  navIndex,
  canNavBack,
  canNavForward,
  vaultConfig,
  vaultTree,
  vaultError,
  allFiles,
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

describe("loadConfig", () => {
  it("populates vaultConfig on success", async () => {
    vaultConfig.value = null;
    const cfg = { inbox: "00-inbox", projects: "01-projects" } as any;
    const daemon = { config: vi.fn(async () => cfg) } as any;
    await loadConfig(daemon);
    expect(vaultConfig.value).toEqual(cfg);
  });

  it("leaves vaultConfig null when the daemon throws (best-effort)", async () => {
    vaultConfig.value = null;
    const daemon = { config: vi.fn(async () => { throw new Error("offline"); }) } as any;
    await loadConfig(daemon);
    expect(vaultConfig.value).toBeNull();
  });
});

describe("initVault error branch", () => {
  it("sets vaultError and nullifies vaultTree when tree() throws", async () => {
    vaultTree.value = null;
    vaultError.value = null;
    const daemon = {
      tree: vi.fn(async () => { throw new Error("daemon unreachable"); }),
    } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await initVault(daemon);
    expect(vaultTree.value).toBeNull();
    expect(vaultError.value).toBe("daemon unreachable");
    spy.mockRestore();
  });

  it("sets a fallback string when a non-Error is thrown", async () => {
    vaultError.value = null;
    const daemon = {
      tree: vi.fn(async () => { throw "string error"; }),
    } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await initVault(daemon);
    expect(vaultError.value).toBe("could not reach the daemon");
    spy.mockRestore();
  });
});

describe("resolveAsset", () => {
  beforeEach(async () => {
    await initVault(
      {
        tree: async () => ({
          root: "",
          entries: [
            { path: "assets/logo.png", name: "logo.png", kind: "file" as const },
            { path: "deep/folder/diagram.svg", name: "diagram.svg", kind: "file" as const },
            { path: "README.md", name: "README.md", kind: "file" as const },
          ],
        }),
      } as any,
    );
  });

  it("resolves by full filename (basename match)", () => {
    expect(resolveAsset("logo.png")).toBe("assets/logo.png");
  });

  it("resolves by full path suffix", () => {
    expect(resolveAsset("folder/diagram.svg")).toBe("deep/folder/diagram.svg");
  });

  it("returns null for an empty string", () => {
    expect(resolveAsset("")).toBeNull();
  });

  it("returns null when the asset does not exist", () => {
    expect(resolveAsset("missing.gif")).toBeNull();
  });

  it("prefers the shortest path when there are multiple matches", async () => {
    // Two files with the same basename at different depths.
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "a/b/img.png", name: "img.png", kind: "file" as const },
          { path: "img.png", name: "img.png", kind: "file" as const },
        ],
      }),
    } as any);
    expect(resolveAsset("img.png")).toBe("img.png");
  });
});

describe("initVault — auto-open first file", () => {
  it("opens the first .md file when previewPath is empty", async () => {
    previewPath.value = "";
    navHistory.value = [];
    navIndex.value = -1;
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "img.png", name: "img.png", kind: "file" as const },
          { path: "notes.md", name: "notes.md", kind: "file" as const },
        ],
      }),
    } as any);
    // The .md file is preferred over the .png.
    expect(previewPath.value).toBe("notes.md");
  });

  it("falls back to _files[0] when no .md file exists (the ?? branch)", async () => {
    previewPath.value = "";
    navHistory.value = [];
    navIndex.value = -1;
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "photo.png", name: "photo.png", kind: "file" as const },
          { path: "logo.svg", name: "logo.svg", kind: "file" as const },
        ],
      }),
    } as any);
    // No .md → falls back to some file (whichever _files[0] is after buildTree sorts).
    expect(["photo.png", "logo.svg"]).toContain(previewPath.value);
  });
});

describe("resolveWikilink — edge cases", () => {
  it("returns null for a blank/whitespace-only name", async () => {
    await initVault({
      tree: async () => ({ root: "", entries: [{ path: "a.md", name: "a.md", kind: "file" as const }] }),
    } as any);
    expect(resolveWikilink("   ")).toBeNull();
    expect(resolveWikilink("")).toBeNull();
  });

  it("selects the shorter path when path-qualified name matches multiple notes", async () => {
    // Both paths end with "notes/project"; the shorter one should win.
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "00-inbox/notes/project.md", name: "project.md", kind: "file" as const },
          { path: "notes/project.md", name: "project.md", kind: "file" as const },
        ],
      }),
    } as any);
    // path-qualified lookup finds both; shorter wins
    expect(resolveWikilink("notes/project")).toBe("notes/project.md");
  });
});

describe("initVault — walk branches and sort tie-break", () => {
  it("handles a file with no extension (no-dot branch in name processing)", async () => {
    // Exercises the `n.name.includes(".") ? ... : n.name` ternary false-branch.
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "Makefile", name: "Makefile", kind: "file" as const },
        ],
      }),
    } as any);
    // A file with no dot should still be indexed and resolvable by its name.
    expect(resolveWikilink("Makefile")).toBe("Makefile");
  });

  it("sorts same-depth duplicates by string length (length tie-break branch)", async () => {
    // Two files at the SAME folder depth — sort falls through to length comparison.
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "ab/note.md", name: "note.md", kind: "file" as const },
          { path: "a/note.md",  name: "note.md", kind: "file" as const },
        ],
      }),
    } as any);
    // Both are 1 folder deep; "a/note.md" is shorter → picked first.
    expect(resolveWikilink("note")).toBe("a/note.md");
  });
});

describe("resolveAsset — path-qualified lookup", () => {
  beforeEach(async () => {
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "attachments/diagrams/arch.png", name: "arch.png", kind: "file" as const },
          { path: "other/arch.png", name: "arch.png", kind: "file" as const },
        ],
      }),
    } as any);
  });

  it("resolves an asset by exact relative path match (path includes '/')", () => {
    // Exercises the `n.includes("/")` true-branch in resolveAsset.
    expect(resolveAsset("attachments/diagrams/arch.png")).toBe("attachments/diagrams/arch.png");
  });

  it("resolves an asset by suffix when given a partial path", () => {
    // "diagrams/arch.png" is a suffix of "attachments/diagrams/arch.png".
    expect(resolveAsset("diagrams/arch.png")).toBe("attachments/diagrams/arch.png");
  });
});

describe("allFiles", () => {
  it("returns the flat file list populated by initVault", async () => {
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "a.md", name: "a.md", kind: "file" as const },
          { path: "b.md", name: "b.md", kind: "file" as const },
        ],
      }),
    } as any);
    expect(allFiles()).toEqual(expect.arrayContaining(["a.md", "b.md"]));
  });
});

describe("resolveWikilink — suffix-match loop branch (longer candidate skipped)", () => {
  it("keeps the shorter match when the loop encounters a longer one second", async () => {
    // Two notes both end with '/foo/note'. Map iteration is insertion order;
    // the shorter path is inserted first so best is set on the first pass.
    // On the second pass !best is false AND path.length < best.length is false
    // → the if-body is skipped (exercises branch 17[1] and binary-expr 18[1]).
    await initVault({
      tree: async () => ({
        root: "",
        entries: [
          { path: "01-projects/foo/note.md", name: "note.md", kind: "file" as const },
          { path: "01-projects/longer-folder/foo/note.md", name: "note.md", kind: "file" as const },
        ],
      }),
    } as any);
    // Both match suffix "/foo/note"; shorter path should be returned.
    expect(resolveWikilink("foo/note")).toBe("01-projects/foo/note.md");
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
