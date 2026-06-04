import { describe, it, expect } from "vitest";
import { buildTree } from "./tree";
import type { VaultNode } from "./types";

const f = (path: string): VaultNode => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind: "file",
});
const d = (path: string): VaultNode => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind: "dir",
});

describe("buildTree", () => {
  it("nests files under their folders", () => {
    const tree = buildTree([d("01-projects"), f("01-projects/a.md"), f("README.md")]);
    // dirs sort before files at the same level
    expect(tree.map((n) => n.name)).toEqual(["01-projects", "README.md"]);
    const projects = tree[0];
    expect(projects.kind).toBe("dir");
    expect(projects.children.map((c) => c.name)).toEqual(["a.md"]);
  });

  it("creates intermediate dirs even if only a deep file is listed", () => {
    // The daemon does send dir entries, but buildTree must be robust if a child
    // arrives before (or without) its parent dir entry.
    const tree = buildTree([f("01-projects/onebrain/cli/x.md")]);
    expect(tree).toHaveLength(1);
    const onebrain = tree[0].children[0];
    expect(onebrain.name).toBe("onebrain");
    const cli = onebrain.children[0];
    expect(cli.children[0].path).toBe("01-projects/onebrain/cli/x.md");
  });

  it("sorts dirs before files, each group case-insensitively", () => {
    const tree = buildTree([f("Zebra.md"), f("apple.md"), d("mid"), f("Beta.md")]);
    expect(tree.map((n) => n.name)).toEqual(["mid", "apple.md", "Beta.md", "Zebra.md"]);
  });

  it("handles an empty vault", () => {
    expect(buildTree([])).toEqual([]);
  });
});
