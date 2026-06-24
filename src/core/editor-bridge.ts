import { signal } from "@preact/signals";

/** Imperative hooks the active editor exposes so shell-level UI (the conflict
 *  toast) can drive it without prop-drilling. Null when no note is open. */
export interface EditorActions {
  /** Force-overwrite the on-disk file with the editor's content (If-Match: *). */
  overwrite(): Promise<void>;
  /** Re-fetch the note from disk, discarding local edits, and reset the editor. */
  reload(): Promise<void>;
}

export const editorBridge = signal<EditorActions | null>(null);
