#!/usr/bin/env node
// Offline guard: fails if the built dist references any EXTERNAL font / CDN so the
// embedded WebUI renders with zero network. Run AFTER `vite build`
// (CI: `npm run build && node scripts/check-offline.mjs`).
//
// Exit codes: 0 = clean · 1 = external reference(s) found · 2 = dist/ missing.
//
// Matching is intentionally broad (plain substring + a few regexes over the
// built files). On minified dist output false positives are practically nil, and
// a release-blocking check should err toward catching an un-bundled font rather
// than letting one slip through. Covers: Google Fonts, the common font/asset
// CDNs that distribute @fontsource (jsDelivr / unpkg / cdnjs / Typekit /
// Fontawesome), ANY external font FILE in a url(), and ANY external @import.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = "dist";
const SCAN_EXT = new Set([".html", ".css", ".js", ".mjs"]);

// Known font/asset CDN hosts — a font pulled from any of these is not bundled.
const FORBIDDEN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "use.typekit.net",
  "use.fontawesome.com",
];

// Structural patterns that mean "fetched over the network" regardless of host.
const FORBIDDEN_RE = [
  // An external font FILE in a url() — fonts must be self-hosted under /assets.
  { re: /url\(\s*["']?https?:\/\/[^)"']*\.(?:woff2?|ttf|otf|eot)\b/i, why: "external font file in url()" },
  // An external stylesheet @import — could transitively pull fonts/CSS at runtime.
  { re: /@import\s+(?:url\(\s*)?["']?https?:\/\//i, why: "external @import" },
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
  for (const host of FORBIDDEN_HOSTS) {
    if (text.includes(host)) hits.push(`${file}: ${host}`);
  }
  for (const { re, why } of FORBIDDEN_RE) {
    const m = text.match(re);
    if (m) hits.push(`${file}: ${why} — ${m[0].slice(0, 80)}`);
  }
}

if (hits.length) {
  console.error("✗ offline check FAILED — external font/CDN references in dist:");
  for (const h of hits) console.error(`    ${h}`);
  console.error("Fonts must be self-hosted (see src/ds/fonts.css / @fontsource).");
  process.exit(1);
}

console.log(`✓ offline check passed — no external font/CDN references in ${distFiles.length} dist files.`);
