import { signal } from "@preact/signals";
import type { DaemonClient } from "./daemon";
import { ConflictError } from "./types";

export type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

export const saveStatus = signal<SaveStatus>("idle");
export const dirty = signal(false);
/** Server's current rev when a save conflicts (for the reload/overwrite toast). */
export const conflictRev = signal<string | null>(null);

const DEBOUNCE_MS = 800;

/** The mutable editing target the saver writes. `rev=null` = note not yet on
 *  disk (first save creates it); `compose()` returns the full file text. */
export interface SaveTarget {
  path: string;
  rev: string | null;
  compose(): string;
}

export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly daemon: DaemonClient,
    private readonly target: SaveTarget,
  ) {}

  /** Mark dirty and (re)arm the debounce. */
  schedule(): void {
    dirty.value = true;
    saveStatus.value = "idle";
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Save now (also used by Cmd+S). Never throws — status flows through signals. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const text = this.target.compose();
    saveStatus.value = "saving";
    try {
      const res =
        this.target.rev === null
          ? await this.daemon.createFile(this.target.path, text)
          : await this.daemon.saveFile(this.target.path, text, this.target.rev);
      this.target.rev = res.rev;
      dirty.value = false;
      saveStatus.value = "saved";
    } catch (e) {
      if (e instanceof ConflictError) {
        conflictRev.value = e.rev;
        saveStatus.value = "conflict";
      } else {
        saveStatus.value = "error";
      }
    }
  }

  /** Resolve a conflict by clobbering the on-disk file (If-Match: *). Used by the
   *  conflict toast's "Overwrite" action — never automatic. */
  async overwrite(): Promise<void> {
    const text = this.target.compose();
    saveStatus.value = "saving";
    try {
      const res = await this.daemon.saveFile(this.target.path, text, "*");
      this.target.rev = res.rev;
      dirty.value = false;
      conflictRev.value = null;
      saveStatus.value = "saved";
    } catch {
      saveStatus.value = "error";
    }
  }

  /** Adopt a server rev (used by the editor's reload-from-disk). */
  adoptRev(rev: string): void {
    this.target.rev = rev;
  }
}
