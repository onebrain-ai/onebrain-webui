// Client for the build-emitted `/changelog.json` (see vite.config.ts
// `emitChangelogJson` / `serveChangelogInDev`). The daemon serves the embedded
// dist, so this static artifact is fetched same-origin with no auth — Settings →
// About renders the latest entry as a "What's new" panel from it.

export interface ChangelogEntry {
  /** Version string from the `## [x.y.z]` heading, or `"Unreleased"`. */
  version: string;
  /** ISO date from the heading (`— 2026-07-01`), or null if none. */
  date: string | null;
  /** The section body under the heading, as raw markdown. */
  markdown: string;
}

export interface ChangelogData {
  /** `latest_version` from the changelog frontmatter (the newest released tag). */
  latest: string | null;
  /** `released` date from the frontmatter. */
  released: string | null;
  entries: ChangelogEntry[];
}

/** Fetch + parse the emitted changelog artifact. Rejects on a non-2xx response
 *  (caller surfaces the error state); pass a signal to cancel on unmount. */
export async function fetchChangelog(signal?: AbortSignal): Promise<ChangelogData> {
  const res = await fetch("/changelog.json", { signal });
  if (!res.ok) throw new Error(`changelog.json ${res.status}`);
  return (await res.json()) as ChangelogData;
}

/** The entry to feature in "What's new": prefer the one matching the frontmatter
 *  `latest`; otherwise the first entry with real content — so a leading empty
 *  `## [Unreleased]` (or a version/heading drift that defeats the match) never
 *  surfaces as a blank panel. Null when the changelog has no content. */
export function latestEntry(data: ChangelogData): ChangelogEntry | null {
  return (
    data.entries.find((e) => e.version === data.latest) ??
    data.entries.find((e) => e.markdown.trim() !== "") ??
    null
  );
}
