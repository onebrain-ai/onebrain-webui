#!/usr/bin/env node
// Delete redundant legacy font files (.woff/.ttf) from the built dist when their
// own `@font-face` also lists a `.woff2`. Modern browsers — and the Tauri/Studio
// webview — pick woff2 (first in the src list) and NEVER request the woff/ttf, so
// those files are dead weight in the embedded binary. Run after `vite build`.
//
// CSS-aware + conservative: a .woff/.ttf FILE is removed only when its @font-face
// also references a real .woff2 FILE. It is KEPT when the face has no woff2 file —
// which includes faces whose woff2 is an INLINE `data:` URI rather than a file
// (KaTeX_Size3, the Vietnamese Chakra/JetBrains subsets): the browser uses that
// inline woff2, so the paired .woff/.ttf file must stay reachable. `hasWoff2`
// below counts only `.woff2` FILENAMES, so a base64 `data:font/woff2` url — which
// has no `.woff2` extension — is (correctly) invisible and never triggers a
// delete. Removing a redundant file leaves a harmless dangling url() the browser
// never fetches (a real .woff2 wins first).
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");
if (!existsSync(assets)) {
  console.log("strip-legacy-fonts: no dist/assets — nothing to strip");
  process.exit(0);
}

const FACE = /@font-face\s*\{[^}]*\}/gs;
const URL = /url\(\s*([^)\s]+?)\s*\)/g;
const isLegacy = (f) => f.endsWith(".woff") || f.endsWith(".ttf");

const deletable = new Set();
const keep = new Set(); // legacy files a woff2-less face depends on — never delete

for (const f of readdirSync(assets)) {
  if (!f.endsWith(".css")) continue;
  const css = readFileSync(join(assets, f), "utf8");
  for (const face of css.match(FACE) ?? []) {
    const urls = [...face.matchAll(URL)].map((m) => basename(m[1].replace(/['"]/g, "")));
    const hasWoff2 = urls.some((u) => u.endsWith(".woff2"));
    for (const u of urls.filter(isLegacy)) (hasWoff2 ? deletable : keep).add(u);
  }
}
for (const k of keep) deletable.delete(k);

let removed = 0;
let bytes = 0;
for (const name of deletable) {
  const p = join(assets, name);
  if (existsSync(p)) {
    bytes += statSync(p).size;
    rmSync(p, { force: true }); // force: tolerate a TOCTOU race with the stat above
    removed += 1;
  }
}
console.log(
  `strip-legacy-fonts: removed ${removed} redundant .woff/.ttf ` +
    `(${(bytes / 1048576).toFixed(2)} MB); kept ${keep.size} woff2-less file(s)`,
);
