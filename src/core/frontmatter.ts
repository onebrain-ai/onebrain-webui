// Frontmatter is the CLIENT's job (Approach A: the daemon writes bytes verbatim).
// The body stays byte-exact; the frontmatter block is re-serialized ONLY when the
// properties form is edited — otherwise its original bytes are preserved.
//
// Known v1 verbatim edge cases (body is NOT 100% byte-exact in two rare cases):
//   (a) CodeMirror normalizes CRLF -> LF in the doc body, so a CRLF source round-
//       trips to LF on save. Obsidian writes LF, so this is rare in practice.
//   (b) A properties-only note (frontmatter + no body) with no trailing newline
//       gains one on save, because compose() joins the fence and body with "\n".
import yaml from "js-yaml";

export interface SplitNote {
  /** Raw YAML between the `---` fences, or null if there is no frontmatter. */
  raw: string | null;
  body: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitNote(src: string): SplitNote {
  const m = FM_RE.exec(src);
  if (m) return { raw: m[1], body: src.slice(m[0].length) };
  return { raw: null, body: src };
}

export function parseFrontmatter(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  // js-yaml v4 `load` is the SAFE default loader (DEFAULT_SCHEMA — no `!!js/*`
  // type construction; that lives only in DEFAULT_FULL_SCHEMA, which we never use).
  // This is NOT PyYAML's unsafe `load`. Do not "fix" it to a non-existent safeLoad.
  const v = yaml.load(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function serializeFrontmatter(obj: Record<string, unknown>): string {
  // lineWidth:-1 = never wrap; the trailing newline is stripped (compose adds the fence).
  return yaml.dump(obj, { lineWidth: -1 }).replace(/\n$/, "");
}

/** Re-assemble the full note text. Preserves the raw frontmatter bytes unless
 *  `edited` is true (then re-serialize `obj`). No frontmatter + not edited =
 *  body only. */
export function compose(
  fm: { raw: string | null; obj: Record<string, unknown>; edited: boolean },
  body: string,
): string {
  if (!fm.edited) {
    return fm.raw === null ? body : `---\n${fm.raw}\n---\n${body}`;
  }
  if (Object.keys(fm.obj).length === 0) return body;
  return `---\n${serializeFrontmatter(fm.obj)}\n---\n${body}`;
}
