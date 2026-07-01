#!/usr/bin/env node
// rollup-plugin-license (vite.config.ts) writes dist/THIRD-PARTY-NOTICES.txt from
// the JS module graph — but two kinds of embedded third-party work are INVISIBLE
// to it and are appended here so the file is COMPLETE for everything embedded in
// the onebrain binary:
//
//   1. CSS-imported fonts — @fontsource families are pulled via `@import` in
//      src/ds/fonts.css, so they're never JS modules the bundler resolves.
//   2. Vendored deps — packages that PRE-INLINE their own dependencies into their
//      published bundle, so the module graph only ever resolves the PARENT.
//      Confirmed cases: `@aiden0z/pptx-renderer` inlines echarts (Apache-2.0,
//      +NOTICE) and zrender (BSD-3-Clause); `xlsx` (SheetJS) is a self-contained
//      bundle (its `.mjs` has no imports) that inlines its Apache-2.0 libraries
//      (cfb, codepage, crc-32, adler-32, ssf, frac, wmf, word). All ride into the
//      WebUI dist. (tslib is 0BSD → no notice; argparse/commander/path-is-absolute
//      are CLI-only, verified absent from dist; entities/pako/d3-* are already
//      tracked by rollup-plugin-license.)
//
// Each entry's LICENSE — and NOTICE, where Apache-2.0 §4(d) requires it — is read
// VERBATIM from node_modules. Run after `vite build`, before the font strip.
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notices = join(root, "dist/THIRD-PARTY-NOTICES.txt");

if (!existsSync(notices)) {
  console.error("append-untracked-notices: dist/THIRD-PARTY-NOTICES.txt missing — rollup-plugin-license must run first (vite build)");
  process.exit(1);
}
// Idempotent: a fresh `vite build` rewrites the file, but guard re-runs anyway.
if (readFileSync(notices, "utf8").includes("Name: @fontsource/inter")) {
  console.log("append-untracked-notices: already appended — skipping");
  process.exit(0);
}

// Package dir (relative to node_modules) for each rollup-invisible embedded work.
const ENTRIES = [
  // CSS-imported fonts (invisible to the JS bundler).
  "@fontsource/inter",
  "@fontsource/chakra-petch",
  "@fontsource/jetbrains-mono",
  // Pre-inlined by @aiden0z/pptx-renderer.
  "@aiden0z/pptx-renderer/node_modules/echarts",
  "@aiden0z/pptx-renderer/node_modules/zrender",
  // Pre-inlined by xlsx (SheetJS) — its declared + transitive Apache-2.0 libs,
  // hoisted to the top of node_modules.
  "cfb",
  "codepage",
  "crc-32",
  "adler-32",
  "ssf",
  "frac",
  "wmf",
  "word",
];

// First file in `dir` whose name is `BASE` or `BASE.<ext>` (LICENSE, LICENSE.md, …).
const pick = (dir, base) =>
  readdirSync(dir)
    .map((f) => join(dir, f))
    .find((p) => {
      const name = p.slice(dir.length + 1).toUpperCase();
      return name === base || name.startsWith(base + ".");
    }) ?? null;

let block = "";
for (const rel of ENTRIES) {
  const dir = join(root, "node_modules", rel);
  const pkgPath = join(dir, "package.json");
  const licPath = existsSync(dir) ? pick(dir, "LICENSE") ?? pick(dir, "LICENCE") : null;
  if (!existsSync(pkgPath) || !licPath) {
    console.error(`append-untracked-notices: missing package.json or LICENSE for ${rel}`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const noticePath = pick(dir, "NOTICE");
  const lines = [
    "\n---\n",
    `Name: ${pkg.name}`,
    `Version: ${pkg.version}`,
    `License: ${pkg.license ?? "?"}`,
    "Private: false",
    pkg.description ? `Description: ${pkg.description}` : "",
    "Note: embedded but not tracked by the JS bundler (CSS-imported font, or a vendored/pre-inlined dependency).",
    "License Text:",
    "===",
    "",
    readFileSync(licPath, "utf8").trimEnd(),
    "",
  ];
  if (noticePath) {
    lines.push("NOTICE:", "===", "", readFileSync(noticePath, "utf8").trimEnd(), "");
  }
  block += lines.filter((l) => l !== "").join("\n") + "\n";
}

appendFileSync(notices, block);
console.log(`append-untracked-notices: appended ${ENTRIES.length} notices (fonts + vendored echarts/zrender + SheetJS libs)`);
