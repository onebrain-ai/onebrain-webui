import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Read the package version once at config load so it can be baked into the bundle
// (see `define` below) — the UI surfaces it in Settings → About.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Read the changelog once at config load so `emitChangelogJson` can bundle a
// structured `changelog.json` into the dist — the WebUI (or any consumer of the
// embedded dist) can fetch it to render a "What's new" view without parsing raw
// markdown itself.
const changelogRaw = readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8");

// beautiful-mermaid hard-codes a Google Fonts `@import` into every diagram's
// inline <style> (Inter + JetBrains Mono, no opt-out). The app is offline-first
// — CSP blocks external styles and DOMPurify strips the rule at runtime, so it
// never actually fetches — but the URL string still rides along in the shipped
// chunk and trips the offline-asset check. Strip it at build time; diagrams fall
// back to the app's own bundled families (which match: Inter / JetBrains Mono).
function stripBeautifulMermaidWebfonts() {
  let stripped = false;
  return {
    name: "strip-beautiful-mermaid-webfonts",
    transform(this: { info?: (m: string) => void }, code: string, id: string) {
      if (!id.includes("beautiful-mermaid") || !code.includes("fonts.googleapis.com")) return null;
      const out = code.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/[^`]*?display=swap'\);/g, "");
      if (out === code) return null;
      stripped = true;
      // Make the strip visible in the build log — if a beautiful-mermaid update
      // ever changes the @import shape, this stops firing and the offline check
      // (which only catches it in .js) is the last line of defence.
      this.info?.("strip-beautiful-mermaid-webfonts: removed Google Fonts @import");
      return { code: out, map: null };
    },
    // The chunk's SOURCEMAP still carries the original @import URL in its
    // sourcesContent. A .map is never executed (DevTools-only) so it's not an
    // offline/runtime risk and the offline check skips it — but neutralise the
    // host anyway so no shipped artifact references an external CDN at all.
    generateBundle(_options: unknown, bundle: Record<string, { type: string; fileName: string; source?: unknown }>) {
      for (const file of Object.values(bundle)) {
        if (
          file.type === "asset" &&
          file.fileName.endsWith(".map") &&
          typeof file.source === "string" &&
          file.source.includes("fonts.googleapis.com")
        ) {
          file.source = file.source.split("fonts.googleapis.com").join("fonts.stripped.invalid");
        }
      }
    },
    buildEnd(this: { warn?: (m: string) => void }) {
      if (!stripped) {
        this.warn?.("strip-beautiful-mermaid-webfonts: no @import was stripped — the pattern may have changed");
      }
    },
  };
}

// Emit a machine-readable `version.json` into the dist root. `__APP_VERSION__`
// is baked into the minified JS (surfaced in Settings → About), but the onebrain
// CLI embeds this dist and reports the running WebUI version from `onebrain
// serve` — it needs a marker it can read without parsing the bundle. Sourced
// from the same `pkg.version` the bundle uses, so the two never drift.
function emitVersionJson(version: string) {
  return {
    name: "emit-version-json",
    generateBundle(this: {
      emitFile: (f: { type: "asset"; fileName: string; source: string }) => void;
    }) {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version })}\n`,
      });
    },
  };
}

interface ChangelogEntry {
  /** Version string from the `## [x.y.z]` heading, or `"Unreleased"`. */
  version: string;
  /** ISO date from the heading (`— 2026-07-01`), or null if none. */
  date: string | null;
  /** The section body (everything under the heading) as raw markdown. */
  markdown: string;
}

// Parse a Keep-a-Changelog `CHANGELOG.md` into structured JSON. Splits on the
// `## ` version headings (the chunk before the first one — title + intro — is
// dropped) and pulls the version + date out of each `## [x.y.z] — date` line,
// leaving the section body as raw markdown for the consumer to render. Frontmatter
// (`latest_version` / `released`) is surfaced at the top level. Format-tolerant:
// a heading it can't parse still yields an entry (version = the raw heading text),
// and it never throws (a bad shape degrades, it doesn't crash the build).
//
// Known limitation: the split is not fence-aware, so a column-0 `## ` line INSIDE
// a fenced code block would be mis-read as a version heading. The changelog has no
// such fences today; keep example headings indented or inline if you ever add one.
function parseChangelog(raw: string): {
  latest: string | null;
  released: string | null;
  entries: ChangelogEntry[];
} {
  let body = raw;
  let latest: string | null = null;
  let released: string | null = null;
  // `\r?` so a CRLF checkout (Windows / core.autocrlf) still recognises the
  // frontmatter block rather than silently dropping `latest`/`released`.
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (frontmatter) {
    body = raw.slice(frontmatter[0].length);
    latest = frontmatter[1].match(/^latest_version:\s*(.+)$/m)?.[1].trim() ?? null;
    released = frontmatter[1].match(/^released:\s*(.+)$/m)?.[1].trim() ?? null;
  }
  const entries = body
    .split(/^## /m)
    .slice(1) // drop the title + intro chunk before the first heading
    .map((section): ChangelogEntry => {
      const newline = section.indexOf("\n");
      const heading = (newline === -1 ? section : section.slice(0, newline)).trim();
      const markdown = (newline === -1 ? "" : section.slice(newline + 1)).trim();
      return {
        version: heading.match(/\[([^\]]+)\]/)?.[1] ?? heading,
        date: heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
        markdown,
      };
    });
  return { latest, released, entries };
}

// Emit a structured `changelog.json` into the dist root (see `emitVersionJson`
// for why a machine-readable marker beats parsing the bundle). Parsed once from
// CHANGELOG.md at config load; pretty-printed since it's fetched on demand, not
// on a hot path.
function emitChangelogJson(raw: string) {
  return {
    name: "emit-changelog-json",
    generateBundle(this: {
      emitFile: (f: { type: "asset"; fileName: string; source: string }) => void;
    }) {
      this.emitFile({
        type: "asset",
        fileName: "changelog.json",
        source: `${JSON.stringify(parseChangelog(raw), null, 2)}\n`,
      });
    },
  };
}

// The daemon (`onebrain serve` / `onebrain daemon`) the WebUI talks to in dev.
// Override with `ONEBRAIN_DAEMON=http://host:port npm run dev` to point at a
// remote / non-default daemon. Default matches `serve.rs` DEFAULT_PORT (6789).
const DAEMON = process.env.ONEBRAIN_DAEMON ?? "http://127.0.0.1:6789";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    preact(),
    stripBeautifulMermaidWebfonts(),
    emitVersionJson(pkg.version),
    emitChangelogJson(changelogRaw),
  ],
  // Compile-time constant: the WebUI version, shown in Settings → About so users
  // can tell which build they're running. Also applied in tests (vitest reads it).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    // Proxy the daemon JSON API in dev so the SPA can call `/api/*` same-origin
    // (no CORS). The auth token is NOT injected here — the browser sends it as a
    // header (see `core/token.ts`), so the proxy just forwards transparently.
    proxy: {
      "/api": {
        target: DAEMON,
        changeOrigin: true,
      },
    },
  },
  build: {
    // The daemon serves this dist as an SPA (`serve --dir dist`); long-cache the
    // hashed assets, the entry HTML stays no-cache (daemon-side).
    target: "es2022",
    // No sourcemaps. This dist is embedded verbatim into the onebrain CLI binary
    // (rust_embed) and served to end users; maps are debug-only (never executed),
    // so emitting them only bloats the bundle and leaves dangling
    // `sourceMappingURL` 404s in the shipped .js. Release CI already deletes
    // *.map before embedding, but disabling here is cleaner (no maps emitted, no
    // trailing comment). Flip to true only for local debugging.
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Count every source module, not just the ones a test happens to import —
      // otherwise untested files silently vanish from the denominator.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "src/test-setup.ts",
        // App entry: CSS imports + a single render() call. Pure bootstrap glue
        // with nothing to assert; testing it would only exercise the framework.
        "src/main.tsx",
      ],
      // The suite is fully covered — gate at 100% so any new uncovered code (or a
      // genuinely-unreachable branch missing its `/* v8 ignore */`) fails CI.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
