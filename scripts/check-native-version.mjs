#!/usr/bin/env node
// Fails when a change needs a new native build but app.json's version wasn't
// bumped (CLAUDE.md, Expo notes). runtimeVersion follows the app version, so
// without a bump an over-the-air update would reach builds that lack the new
// native code, and the app would crash on start.
//
// Native changes: anything under apps/mobile/modules, app.config.ts, any
// app.json setting other than version, or an added, removed or changed app
// dependency that isn't known to be JavaScript only.
//
// Usage: node scripts/check-native-version.mjs [base ref, default origin/main]

import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'origin/main';
const APP = 'apps/mobile';
// Dependencies with no native code: changing them is safe over the air.
const JS_ONLY = new Set(['@supabase/supabase-js', 'drizzle-orm']);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const atBase = (path) => {
  try {
    return git('show', `${mergeBase}:${path}`);
  } catch {
    return null;
  }
};
const atHead = (path) => git('show', `HEAD:${path}`);

const mergeBase = git('merge-base', base, 'HEAD').trim();
const changed = git('diff', '--name-only', mergeBase, 'HEAD').split('\n').filter(Boolean);
const reasons = [];

for (const file of changed) {
  if (file.startsWith(`${APP}/modules/`)) reasons.push(`${file} (native module)`);
  if (file === `${APP}/app.config.ts`) reasons.push(file);
}

const baseApp = atBase(`${APP}/app.json`);
const headApp = JSON.parse(atHead(`${APP}/app.json`));
const baseVersion = baseApp ? JSON.parse(baseApp).expo.version : null;
if (baseApp && changed.includes(`${APP}/app.json`)) {
  const strip = (json) => JSON.stringify({ ...json.expo, version: undefined });
  if (strip(JSON.parse(baseApp)) !== strip(headApp)) reasons.push(`${APP}/app.json settings`);
}

const basePkg = atBase(`${APP}/package.json`);
if (basePkg && changed.includes(`${APP}/package.json`)) {
  const before = JSON.parse(basePkg).dependencies ?? {};
  const after = JSON.parse(atHead(`${APP}/package.json`)).dependencies ?? {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] === after[name] || JS_ONLY.has(name) || after[name]?.startsWith('workspace:')) continue;
    reasons.push(`dependency ${name} ${before[name] ?? '(new)'} -> ${after[name] ?? '(removed)'}`);
  }
}

if (reasons.length === 0) {
  console.log('No native changes: safe to ship over the air.');
} else if (headApp.expo.version !== baseVersion) {
  console.log(`Native changes, and the version moved ${baseVersion} -> ${headApp.expo.version}:`);
  for (const reason of reasons) console.log(`  ${reason}`);
} else {
  console.error(`These changes need a new native build, so bump "version" in ${APP}/app.json (now ${baseVersion}):`);
  for (const reason of reasons) console.error(`  ${reason}`);
  console.error('Builds on the old version would otherwise get an over-the-air update without this native code.');
  process.exit(1);
}
