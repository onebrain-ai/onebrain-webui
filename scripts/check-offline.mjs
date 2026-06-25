#!/usr/bin/env node
// Offline guard: fails if the built dist references any external font / CDN host.
// The embedded WebUI must render with zero network, so a stray Google-Fonts (or
// other CDN) URL in the output is a release-blocking regression. Run AFTER
// `vite build` (CI: `npm run build && node scripts/check-offline.mjs`).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "dist";
const SCAN_EXT = new Set([".html", ".css", ".js", ".mjs"]);
// Hosts that would force a network fetch at runtime. Add to this list rather
// than relaxing it.
const FORBIDDEN = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "https://fonts.",
  "http://fonts.",
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (SCAN_EXT.has(extname(p))) out.push(p);
  }
  return out;
}

let distFiles;
try {
  distFiles = walk(DIST);
} catch {
  console.error(`✗ offline check: '${DIST}/' not found — run 'npm run build' first.`);
  process.exit(2);
}

const hits = [];
for (const file of distFiles) {
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) hits.push(`${file}: ${needle}`);
  }
}

if (hits.length) {
  console.error("✗ offline check FAILED — external font/CDN references in dist:");
  for (const h of hits) console.error(`    ${h}`);
  console.error("Fonts must be self-hosted (see src/ds/fonts.css / @fontsource).");
  process.exit(1);
}

console.log(`✓ offline check passed — no external font/CDN references in ${distFiles.length} dist files.`);
