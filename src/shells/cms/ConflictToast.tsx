import { saveStatus } from "../../core/autosave";

/** Shown only while a save is in the "conflict" state. Never auto-resolves —
 *  the user picks Reload (discard local, take disk) or Overwrite (clobber disk). */
export function ConflictToast({ onReload, onOverwrite }: { onReload: () => void; onOverwrite: () => void }) {
  if (saveStatus.value !== "conflict") return null;
  return (
    <div class="cms-toast" data-testid="cms-conflict" role="alert">
      <span>This note changed on disk since you opened it.</span>
      <button onClick={onReload}>Reload (lose local)</button>
      <button onClick={onOverwrite}>Overwrite</button>
    </div>
  );
}
