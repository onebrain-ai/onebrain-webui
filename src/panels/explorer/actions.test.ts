import { it, expect, vi } from "vitest";
import { newNote, deleteEntry } from "./actions";

vi.mock("../bus", () => ({ initVault: vi.fn(async () => {}) }));

it("newNote creates the file then opens it", async () => {
  const daemon = { createFile: vi.fn(async () => ({ path: "01-projects/x.md", rev: "1" })) } as any;
  const opened: string[] = [];
  await newNote(daemon, "01-projects/x.md", (p) => opened.push(p));
  expect(daemon.createFile).toHaveBeenCalledWith("01-projects/x.md", "");
  expect(opened).toEqual(["01-projects/x.md"]);
});

it("deleteEntry only trashes after confirm returns true", async () => {
  const daemon = { deleteFile: vi.fn(async () => ({ path: "a.md", trashed_to: ".trash/a.md" })) } as any;
  await deleteEntry(daemon, "a.md", false, async () => false);
  expect(daemon.deleteFile).not.toHaveBeenCalled();
  await deleteEntry(daemon, "a.md", false, async () => true);
  expect(daemon.deleteFile).toHaveBeenCalledWith("a.md");
});
