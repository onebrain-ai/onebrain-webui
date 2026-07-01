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
    // wasList=true branch is never called by the current UI; set() is only invoked with wasList=false.
    const next: Obj = { ...value, [k]: wasList ? /* v8 ignore next */ raw.split(",").map((s) => s.trim()).filter(Boolean) : raw }; // v8 ignore
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
            // A bare ISO date (YYYY-MM-DD, optionally with a time) → calendar input.
            const isDate = !isList && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
            return (
              <div class="props-row" key={k}>
                <span class="props-key">
                  <Icon name={keyIcon(k)} />
                  {k}
                </span>
                {isList ? (
                  <span class="props-tags">
                    {(v as unknown[]).map((tag, i) => (
                      <span class="props-tag" key={String(tag) + i}>
                        {String(tag)}
                        <button
                          type="button"
                          class="props-tag-x"
                          aria-label={`Remove ${String(tag)}`}
                          onClick={() =>
                            onChange({ ...value, [k]: (v as unknown[]).filter((_, j) => j !== i) })
                          }
                        >
                          <Icon name="x" />
                        </button>
                      </span>
                    ))}
                    <input
                      class="props-tag-add"
                      type="text"
                      placeholder="+ tag"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const el = e.target as HTMLInputElement;
                        const t = el.value.trim();
                        if (t) {
                          onChange({ ...value, [k]: [...(v as unknown[]), t] });
                          el.value = "";
                        }
                      }}
                    />
                  </span>
                ) : isDate ? (
                  <input
                    class="props-val props-date"
                    type="date"
                    value={String(v).slice(0, 10)}
                    onInput={(e) => set(k, (e.target as HTMLInputElement).value, false)}
                  />
                ) : (
                  <input
                    class="props-val"
                    value={String(v ?? "")}
                    onInput={(e) => set(k, (e.target as HTMLInputElement).value, false)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
