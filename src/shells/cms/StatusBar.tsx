import { saveStatus, dirty } from "../../core/autosave";

const LABEL: Record<string, string> = {
  saving: "● saving…",
  saved: "✓ saved",
  conflict: "⚠ conflict",
  error: "⚠ save failed",
};

/** Bottom-corner save indicator driven by the autosave signals. */
export function StatusBar() {
  const s = saveStatus.value;
  const text = s === "idle" ? (dirty.value ? "● unsaved" : "") : (LABEL[s] ?? "");
  return (
    <div class="cms-statusbar" data-testid="cms-statusbar">
      {text}
    </div>
  );
}
