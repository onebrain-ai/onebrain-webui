import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent, screen } from "@testing-library/preact";
import * as editorModule from "./editor";
import { previewPath } from "../bus";
import { Autosaver, saveStatus, dirty, conflictRev } from "../../core/autosave";
import { editorBridge } from "../../core/editor-bridge";

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

  it("defaults to the reading view (rendered HTML), and toggles to edit", async () => {
    previewPath.value = "a.md";
    render(<editorPanel.Component ctx={ctx} />);
    // reading view is the default surface on open — body rendered via renderMarkdown
    await waitFor(() =>
      expect(screen.getByTestId("ed-reading").innerHTML).toContain("<h1>Hello</h1>"),
    );
    // toggling switches to the edit surface (reading node removed)
    fireEvent.click(screen.getByTestId("ed-reading-toggle"));
    expect(screen.queryByTestId("ed-reading")).toBeNull();
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

  it("resets save/conflict state when switching notes", async () => {
    previewPath.value = "a.md";
    const { container } = render(<editorPanel.Component ctx={ctx} />);
    await waitFor(() =>
      expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("Hello"),
    );
    // simulate a lingering conflict from note A
    saveStatus.value = "conflict";
    conflictRev.value = "5";
    dirty.value = true;
    // switch to note B — the editor reads previewPath in render, so this re-renders
    // and re-runs the [path] effect, which must clear the stale state
    previewPath.value = "b.md";
    await waitFor(() => expect(saveStatus.value).toBe("idle"));
    expect(conflictRev.value).toBe(null);
    expect(dirty.value).toBe(false);
  });

  it("reload that resolves after a note-switch does not clobber the new note", async () => {
    // Per-path content; the SECOND fetch of a.md (the reload) is deferred so we
    // can resolve it *after* switching to b.md, reproducing the in-flight race.
    let releaseReload!: (v: { path: string; content: string; rev: string }) => void;
    const reloadPromise = new Promise<{ path: string; content: string; rev: string }>((res) => {
      releaseReload = res;
    });
    let aSeen = false;
    const raceDaemon = {
      file: vi.fn(async (p: string) => {
        if (p === "a.md") {
          if (!aSeen) {
            aSeen = true; // first a.md fetch = initial load
            return { path: "a.md", content: "---\ntags: [x]\n---\n# AAA-body", rev: "111" };
          }
          return reloadPromise; // second a.md fetch = reload (deferred)
        }
        return { path: "b.md", content: "---\ntags: [y]\n---\n# BBB-body", rev: "999" };
      }),
      saveFile: vi.fn(async () => ({ path: "x", rev: "0" })),
      createFile: vi.fn(),
    } as any;
    const raceCtx = { daemon: raceDaemon, openFile: () => {}, addPanel: () => {} };

    previewPath.value = "a.md";
    const { container } = render(<editorPanel.Component ctx={raceCtx} />);
    await waitFor(() =>
      expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("AAA-body"),
    );
    // Grab note A's reload action (the conflict toast would call this) and fire it;
    // its fetch is now in flight against the deferred promise.
    const reloadA = editorBridge.value!.reload;
    const reloadDone = reloadA();

    // Switch to note B BEFORE A's reload fetch resolves.
    previewPath.value = "b.md";
    await waitFor(() =>
      expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("BBB-body"),
    );
    // simulate B being mid-edit so a stale "mark clean" would be a real data loss
    dirty.value = true;

    // Now resolve A's reload fetch — the guard must abandon it.
    releaseReload({ path: "a.md", content: "---\ntags: [x]\n---\n# AAA-body", rev: "111" });
    await reloadDone;

    // B's view must still hold B's body — A's reload must NOT have dispatched into it.
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("BBB-body");
    expect(container.querySelector(".cm-content")?.textContent ?? "").not.toContain("AAA-body");
    // and B must not have been silently marked clean by A's stale reload.
    expect(dirty.value).toBe(true);
  });
});
