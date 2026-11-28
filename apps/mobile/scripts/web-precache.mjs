#!/usr/bin/env node
// Web build (decision 0039): after `npx expo export --platform web`, lists the
// built files for the service worker (public/sw.js) to store on install, and
// stamps the worker's registration with this build's id so a new build
// replaces the old files.
//
// Usage: node scripts/web-precache.mjs [dist folder, default dist]

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const SKIP = new Set(['index.html', 'precache.json', 'sw.js', '_headers', 'metadata.json']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(dist)
  .map((path) => relative(dist, path).split(sep).join('/'))
  .filter((path) => !SKIP.has(path) && !path.endsWith('.map'))
  .sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(readFileSync(join(dist, file)));
const version = hash.digest('hex').slice(0, 12);

writeFileSync(join(dist, 'precache.json'), JSON.stringify(files.map((f) => `/${f}`)));
const indexPath = join(dist, 'index.html');
const index = readFileSync(indexPath, 'utf8');
if (!index.includes('__SW_VERSION__')) throw new Error('index.html has no __SW_VERSION__ placeholder');
writeFileSync(indexPath, index.replace('__SW_VERSION__', version));
console.log(`Precache: ${files.length} files, build ${version}`);
