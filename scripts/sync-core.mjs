#!/usr/bin/env node
/**
 * Vendor @dreamusichef/core from node_modules into the committed core/ tree.
 * Copies js/, css/, brand/ only. Leaves core/README.md (Interval consumer notes) in place.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = join(root, 'node_modules', '@dreamusichef', 'core');
const coreRoot = join(root, 'core');

if (!existsSync(pkgRoot)) {
  console.error(
    'Missing node_modules/@dreamusichef/core. Run: npm install @dreamusichef/core@<version>'
  );
  process.exit(1);
}

for (const dir of ['js', 'css', 'brand']) {
  const from = join(pkgRoot, dir);
  const to = join(coreRoot, dir);
  if (!existsSync(from)) {
    console.error(`Package is missing required folder: ${dir}/`);
    process.exit(1);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`Synced ${dir}/ → core/${dir}/`);
}

console.log('Done. core/README.md was left unchanged.');
