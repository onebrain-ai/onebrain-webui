import "./properties.css";

type Obj = Record<string, unknown>;

/** Obsidian-Properties-style frontmatter editor. Lists render comma-joined; an
 *  edit re-emits the whole object so the editor can mark frontmatter `edited`
 *  (which triggers js-yaml re-serialization on save). */
export function Properties({ value, onChange }: { value: Obj; onChange: (next: Obj) => void }) {
  const keys = Object.keys(value);
  if (keys.length === 0) return null;

  const set = (k: string, raw: string, wasList: boolean) => {
    const next: Obj = { ...value, [k]: wasList ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw };
    onChange(next);
  };

  return (
    <div class="props">
      {keys.map((k) => {
        const v = value[k];
        const isList = Array.isArray(v);
        const display = isList ? (v as unknown[]).join(", ") : String(v ?? "");
        return (
          <label class="props-row" key={k}>
            <span class="props-key">{k}</span>
            <input
              class="props-val"
              value={display}
              onInput={(e) => set(k, (e.target as HTMLInputElement).value, isList)}
            />
          </label>
        );
      })}
    </div>
  );
}
