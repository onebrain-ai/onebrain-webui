import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent, screen } from "@testing-library/preact";
import { editorPanel } from "./editor";
import { previewPath } from "../bus";

const daemon = {
  file: vi.fn(async () => ({ path: "a.md", content: "---\ntags: [x]\n---\n# Hello", rev: "111" })),
  saveFile: vi.fn(async () => ({ path: "a.md", rev: "222" })),
  createFile: vi.fn(),
} as any;
const ctx = { daemon, openFile: () => {}, addPanel: () => {} };

describe("editorPanel", () => {
  it("loads the open note's body into the editor", async () => {
    previewPath.value = "a.md";
    const Editor = editorPanel.Component;
    const { container } = render(<Editor ctx={ctx} />);
    await waitFor(() => expect(daemon.file).toHaveBeenCalledWith("a.md"));
    await waitFor(() =>
      expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("Hello"),
    );
  });

  it("toggles to reading mode and renders HTML via renderMarkdown", async () => {
    previewPath.value = "a.md";
    const { container } = render(<editorPanel.Component ctx={ctx} />);
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("Hello"));
    fireEvent.click(screen.getByTestId("ed-reading-toggle"));
    expect(screen.getByTestId("ed-reading")).toBeTruthy();
  });
});
