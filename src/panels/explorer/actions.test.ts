import { it, expect, vi } from "vitest";
import { newNote, newFolder, renameEntry, deleteEntry } from "./actions";

vi.mock("../bus", () => ({ initVault: vi.fn(async () => {}) }));

it("newNote creates the file then opens it", async () => {
  const daemon = { createFile: vi.fn(async () => ({ path: "01-projects/x.md", rev: "1" })) } as any;
  const opened: string[] = [];
  await newNote(daemon, "01-projects/x.md", (p) => opened.push(p));
  expect(daemon.createFile).toHaveBeenCalledWith("01-projects/x.md", "");
  expect(opened).toEqual(["01-projects/x.md"]);
});

it("newFolder creates a folder (no open callback needed)", async () => {
  const daemon = { createFolder: vi.fn(async () => ({ path: "01-projects/sub" })) } as any;
  await newFolder(daemon, "01-projects/sub");
  expect(daemon.createFolder).toHaveBeenCalledWith("01-projects/sub");
});

it("renameEntry moves from → to", async () => {
  const daemon = { moveFile: vi.fn(async () => ({ from: "a.md", to: "b.md", rewrites: 0 })) } as any;
  await renameEntry(daemon, "a.md", "b.md");
  expect(daemon.moveFile).toHaveBeenCalledWith("a.md", "b.md");
});

it("deleteEntry only trashes after confirm returns true", async () => {
  const daemon = { deleteFile: vi.fn(async () => ({ path: "a.md", trashed_to: ".trash/a.md" })) } as any;
  await deleteEntry(daemon, "a.md", false, async () => false);
  expect(daemon.deleteFile).not.toHaveBeenCalled();
  await deleteEntry(daemon, "a.md", false, async () => true);
  expect(daemon.deleteFile).toHaveBeenCalledWith("a.md");
});

it("deleteEntry calls deleteFolder (not deleteFile) for a directory", async () => {
  const daemon = {
    deleteFile: vi.fn(),
    deleteFolder: vi.fn(async () => ({ path: "01-projects", trashed_to: ".trash/01-projects" })),
  } as any;
  await deleteEntry(daemon, "01-projects", true, async () => true);
  expect(daemon.deleteFolder).toHaveBeenCalledWith("01-projects");
  expect(daemon.deleteFile).not.toHaveBeenCalled();
});
