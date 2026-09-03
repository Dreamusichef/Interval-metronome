#!/usr/bin/env node
/**
 * Upgrade vendored Core to a pinned @dreamusichef/core version.
 *
 * Usage:
 *   npm run upgrade-core -- 1.0.1
 *   node scripts/upgrade-core.mjs 1.0.1
 *
 * Steps: npm install pin → sync core/ → cache-bust → npm test
 * Requires GitHub Packages auth (NODE_AUTH_TOKEN or ~/.npmrc login).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] || '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run upgrade-core -- <X.Y.Z>');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

run('npm', ['install', `@dreamusichef/core@${version}`, '--save-exact']);
run('node', ['scripts/sync-core.mjs']);
run('node', ['scripts/cache-bust-core.mjs', version]);
run('npm', ['test']);

console.log(`\nCore upgrade to ${version} complete.`);
console.log('Review the diff (core/, package.json, package-lock.json, HTML/?v=), then PR.');
