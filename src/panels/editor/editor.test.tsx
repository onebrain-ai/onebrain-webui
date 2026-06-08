import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent, screen } from "@testing-library/preact";
import * as editorModule from "./editor";
import { previewPath } from "../bus";
import { Autosaver } from "../../core/autosave";

const { editorPanel } = editorModule;

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

  it("Cmd+S force-flushes the autosave", async () => {
    // jsdom does not propagate key events through CodeMirror's event handler
    // chain, so fireEvent.keyDown cannot reach the Mod-s binding. Instead we
    // render the editor (which arms _cmdSaveRun), then invoke that run-function
    // directly — the same function that CodeMirror calls on Cmd+S in the browser.
    previewPath.value = "a.md";
    const flushSpy = vi.spyOn(Autosaver.prototype, "flush").mockResolvedValue(undefined as any);
    const { container } = render(<editorPanel.Component ctx={ctx} />);
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
    // _cmdSaveRun is set by the editor's useEffect once the note loads
    await waitFor(() => expect(editorModule._cmdSaveRun).toBeTruthy());
    const result = editorModule._cmdSaveRun!();
    expect(result).toBe(true);  // binding must return true to suppress Save dialog
    expect(flushSpy).toHaveBeenCalled();
    flushSpy.mockRestore();
  });
});
