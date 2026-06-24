import { Icon, type IconName } from "../../ui/Icon";
import { propertiesCollapsed, togglePropertiesCollapsed } from "../../core/stores";
import "./properties.css";

type Obj = Record<string, unknown>;

/** Map a frontmatter key to a leading icon (best-effort; falls back to hash). */
function keyIcon(k: string): IconName {
  const key = k.toLowerCase();
  if (key === "title" || key === "name") return "heading";
  if (key === "tags" || key === "tag") return "tag";
  if (key === "created") return "calendar-plus";
  if (key === "updated" || key === "modified" || key === "date") return "calendar";
  return "hash";
}

/** Obsidian-Properties-style frontmatter editor. A collapsible header folds the
 *  fields up to a thin bar (persisted) so they don't push the note content down.
 *  Lists render comma-joined; an edit re-emits the whole object so the editor can
 *  mark frontmatter `edited` (triggers js-yaml re-serialization on save). */
export function Properties({ value, onChange }: { value: Obj; onChange: (next: Obj) => void }) {
  const keys = Object.keys(value);
  if (keys.length === 0) return null;
  const collapsed = propertiesCollapsed.value;

  const set = (k: string, raw: string, wasList: boolean) => {
    const next: Obj = { ...value, [k]: wasList ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw };
    onChange(next);
  };

  return (
    <div class={collapsed ? "props collapsed" : "props"}>
      <button
        class="props-head"
        type="button"
        data-testid="props-toggle"
        aria-expanded={!collapsed}
        onClick={togglePropertiesCollapsed}
      >
        <Icon name="chevron-down" class="props-chev" />
        <span class="props-head-lab">Properties</span>
        <span class="props-count">{keys.length}</span>
      </button>
      {!collapsed && (
        <div class="props-body">
          {keys.map((k) => {
            const v = value[k];
            const isList = Array.isArray(v);
            const display = isList ? (v as unknown[]).join(", ") : String(v ?? "");
            return (
              <label class="props-row" key={k}>
                <span class="props-key">
                  <Icon name={keyIcon(k)} />
                  {k}
                </span>
                <input
                  class="props-val"
                  value={display}
                  onInput={(e) => set(k, (e.target as HTMLInputElement).value, isList)}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
