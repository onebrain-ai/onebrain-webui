#!/usr/bin/env node
// Emit `dist/FONT-NOTICES.txt` from the embedded fonts' ACTUAL license files, so
// the OFL-1.1 / MIT attribution those licenses require travels with the dist —
// and therefore with the onebrain binary that embeds it, and the daemon that
// serves it at /FONT-NOTICES.txt. Run after `vite build`.
//
// SCOPE: fonts only. The bundled JS libraries (xlsx, @maxgraph/core — both
// Apache-2.0 — etc.) carry their own attribution obligations that a separate,
// full THIRD-PARTY-NOTICES step should cover; this file is deliberately named
// for its font-only scope so it doesn't over-promise.
//
// Verbatim concatenation (no hand-written license text) keeps it always-accurate
// and in sync with the installed font versions. Fails the build if a license
// file is missing — that means a font was added without recording its license.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every font whose files land in the embedded dist. Keep in sync with src/ds/fonts.css
// (@fontsource imports) + the KaTeX dependency.
const FONTS = [
  { name: "Inter — @fontsource/inter (SIL OFL 1.1)", file: "node_modules/@fontsource/inter/LICENSE" },
  { name: "Chakra Petch — @fontsource/chakra-petch (SIL OFL 1.1)", file: "node_modules/@fontsource/chakra-petch/LICENSE" },
  { name: "JetBrains Mono — @fontsource/jetbrains-mono (SIL OFL 1.1)", file: "node_modules/@fontsource/jetbrains-mono/LICENSE" },
  { name: "KaTeX (library + math fonts) — MIT", file: "node_modules/katex/LICENSE" },
];

const RULE = "=".repeat(76);
const out = [
  "OneBrain Web UI — Third-Party Notices",
  "",
  "This build embeds the fonts below (and so does any onebrain binary that",
  "bundles this Web UI). Their licenses require this attribution to accompany",
  "the distribution. The full, verbatim license text for each follows.",
  "",
];

for (const { name, file } of FONTS) {
  const path = join(root, file);
  if (!existsSync(path)) {
    console.error(`gen-notices: missing license file for "${name}": ${file}`);
    process.exit(1);
  }
  out.push(RULE, name, RULE, "", readFileSync(path, "utf8").trimEnd(), "", "");
}

const dest = join(root, "dist/FONT-NOTICES.txt");
if (!existsSync(join(root, "dist"))) {
  console.error("gen-notices: dist/ missing — run after `vite build`");
  process.exit(2);
}
writeFileSync(dest, out.join("\n"));
console.log(`gen-notices: wrote ${dest} (${FONTS.length} font licenses)`);
