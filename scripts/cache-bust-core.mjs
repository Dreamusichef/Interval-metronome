#!/usr/bin/env node
/**
 * Bump ?v= query tokens on core/ asset references after a Core vendor upgrade.
 *
 * Usage:
 *   node scripts/cache-bust-core.mjs [stamp]
 *
 * Default stamp is the installed @dreamusichef/core version (e.g. 1.0.1).
 * Updates HTML/JS under the repo that reference core/{js,css,brand}/…?v=…
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPkgVersion() {
  const pkgPath = join(root, 'node_modules', '@dreamusichef', 'core', 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return null;
  }
}

const stamp = process.argv[2] || readPkgVersion();
if (!stamp) {
  console.error('No stamp given and @dreamusichef/core is not installed.');
  process.exit(1);
}

const EXT = new Set(['.html', '.js', '.cjs', '.mjs', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude']);

/** Match core/{js|css|brand}/…?v=<token> (token: alnum / . _ -) */
const CORE_V_RE =
  /(core\/(?:js|css|brand)\/[^"'?\s]*\?v=)([A-Za-z0-9._-]+)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.has(name.slice(name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

let filesChanged = 0;
let replacements = 0;

for (const file of walk(root)) {
  const before = readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(CORE_V_RE, (full, prefix, old) => {
    if (old === stamp) return full;
    count += 1;
    return prefix + stamp;
  });
  if (count === 0) continue;
  writeFileSync(file, after);
  filesChanged += 1;
  replacements += count;
  console.log(`${relative(root, file)}: ${count} bump(s) → ?v=${stamp}`);
}

console.log(
  replacements
    ? `Cache-bust done: ${replacements} token(s) in ${filesChanged} file(s) → ${stamp}`
    : `No core/?v= tokens needed updating (already ${stamp} or none found).`
);
