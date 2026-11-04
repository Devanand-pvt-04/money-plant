// Model test for milestone 6, build 2 (decision 0012).
//
//   pnpm --filter @money-plant/ai-worker eval -- --models qwen2.5:7b,llama3.1:8b
//
// Signs in as you (an email code, like the app), reads the entries you
// categorised by hand, and asks each model to categorise those merchants with
// the same fields a real job carries. With --sample (or when none of your
// tagged merchants would reach the AI) it tests on a built-in set of made-up
// Indian shops the dictionary doesn't know instead, with no sign-in. The labelled set and the full report
// (with merchant names) stay in eval-data/, which git ignores. The summary
// printed at the end has no merchant names, so it is safe to share.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { runCategorise, type CategoriseAnswer } from '../jobs/categorise';
import { ollama } from '../ollama';
import { buildDataset, type Dataset, type EvalAccount, type EvalTransaction } from './dataset';
import { sampleDataset } from './sample';
import { score, summaryTable, type Miss, type Score } from './score';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const envFile = here('../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = here('../../eval-data/');
const datasetFile = `${dataDir}dataset.json`;
const BATCH = 25;
const PAGE = 1000;

async function signIn(url: string, anonKey: string) {
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await prompt.question('Your Money Plant email: ')).trim();
  const { error: sendError } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (sendError) throw new Error(`Couldn't send the code: ${sendError.message}`);
  const token = (await prompt.question('The code from the email: ')).trim();
  prompt.close();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message ?? 'no session'}`);
  // Every read carries the signed-in user's token explicitly; without it row-level security returns nothing, silently.
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

/** Reads your own rows through row-level security, as the app does. Nothing is written. */
async function download(): Promise<Dataset> {
  const mobileEnv = parseEnv(readFileSync(here('../../../../apps/mobile/.env'), 'utf8'));
  const url = process.env.SUPABASE_URL ?? mobileEnv.EXPO_PUBLIC_SUPABASE_URL!;
  const supabase = await signIn(url, mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY!);
  const accounts: EvalAccount[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, type, name, parent_id, category_key, deleted_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading accounts failed: ${error.message}`);
    accounts.push(...(data as EvalAccount[]));
    if (data.length < PAGE) break;
  }
  const transactions: EvalTransaction[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('occurred_at, counterparty, kind, postings(account_id, amount_paise, deleted_at), sources(kind, parsed_fields)')
      // Your own picks, and entries your own rules and patterns placed: both are categories you chose.
      .in('category_reason', ['user', 'rule', 'pattern'])
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading entries failed: ${error.message}`);
    transactions.push(...(data as unknown as EvalTransaction[]));
    if (data.length < PAGE) break;
  }
  console.log(`Read ${accounts.length} accounts and categories, and ${transactions.length} entries you categorised yourself or with your rules.`);
  return buildDataset(accounts, transactions);
}

async function answer(model: string, dataset: Dataset, merchants: Dataset['merchants']): Promise<{ answers: CategoriseAnswer[]; seconds: number }> {
  const local = ollama({ ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434', model });
  const installed = await local.installed();
  if (!installed.some((name) => name === model || name === `${model}:latest`)) throw new Error(`Model ${model} isn't pulled. Run: ollama pull ${model}`);
  // One untimed call first, so loading the model into the GPU isn't counted.
  await runCategorise(local, { items: [merchants[0]!.item], categories: dataset.categories }).catch(() => undefined);
  const answers: CategoriseAnswer[] = [];
  const started = Date.now();
  for (let i = 0; i < merchants.length; i += BATCH) {
    const batch = merchants.slice(i, i + BATCH);
    try {
      answers.push(...(await runCategorise(local, { items: batch.map((m) => m.item), categories: dataset.categories })).results);
    } catch (error) {
      // A batch the model couldn't answer counts as unknown, as it would in the app after its retry.
      console.log(`  ${model}: a batch failed (${(error as Error).message})`);
    }
    process.stdout.write(`  ${model}: ${Math.min(i + BATCH, merchants.length)} of ${merchants.length}\r`);
  }
  process.stdout.write('\n');
  return { answers, seconds: (Date.now() - started) / 1000 };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { models: { type: 'string' }, refresh: { type: 'boolean', default: false }, sample: { type: 'boolean', default: false } } });
  // PowerShell turns "a,b,c" into "a b c", so either separator works.
  const models = (values.models ?? process.env.AI_MODEL ?? '').split(/[\s,]+/).map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) throw new Error('Name the models to test: --models qwen2.5:7b,llama3.1:8b');

  mkdirSync(dataDir, { recursive: true });
  let dataset: Dataset;
  let sample = values.sample;
  if (sample) {
    dataset = sampleDataset();
  } else {
    const saved = existsSync(datasetFile) && !values.refresh ? (JSON.parse(readFileSync(datasetFile, 'utf8')) as Dataset) : null;
    if (saved && saved.merchants.length > 0) {
      dataset = saved;
      console.log(`Using the saved set in eval-data/dataset.json (--refresh to download again)`);
    } else {
      dataset = await download();
      if (dataset.merchants.length > 0) writeFileSync(datasetFile, JSON.stringify(dataset, null, 1));
    }
    const unseenOwn = dataset.merchants.filter((m) => !m.inDictionary).length;
    console.log(`${dataset.merchants.length} merchants you tagged by hand. ${unseenOwn} aren't in the built-in dictionary, so the app would ask the AI about them.`);
    for (const [reason, count] of Object.entries(dataset.skipped ?? {})) console.log(`  Left out ${count}: ${reason}`);
    if (unseenOwn === 0) {
      console.log('None of your merchants would reach the AI, so testing on the built-in sample instead.');
      sample = true;
      dataset = sampleDataset();
    }
  }
  if (sample) {
    console.log(`Built-in sample: ${dataset.merchants.length} made-up shops of the kind the dictionary misses.`);
    for (const [reason, count] of Object.entries(dataset.skipped ?? {})) console.log(`  Left out ${count}: ${reason}`);
  }
  const unseen = dataset.merchants.filter((m) => !m.inDictionary);
  if (unseen.length === 0) throw new Error('No merchants to test with yet');

  const aiScores: Score[] = [];
  const allScores: Score[] = [];
  const misses = new Map<string, Miss[]>();
  for (const model of models) {
    const { answers, seconds } = await answer(model, dataset, dataset.merchants);
    const unseenSeconds = seconds * (unseen.length / dataset.merchants.length);
    const ai = score(model, unseen, answers, unseenSeconds);
    aiScores.push(ai.score);
    allScores.push(score(model, dataset.merchants, answers, seconds).score);
    misses.set(model, ai.misses);
  }

  const summary = [
    summaryTable('Merchants the AI would see (not in the dictionary)', aiScores),
    '',
    summaryTable(sample ? 'Whole built-in sample' : 'All merchants you tagged', allScores),
  ].join('\n');
  const details = models.map((model) => [
    `### Wrong or unknown: ${model}`,
    '',
    `| Merchant | ${sample ? 'Expected' : 'You chose'} | Model said | Confidence |`,
    '| --- | --- | --- | --- |',
    ...misses.get(model)!.map((m) => `| ${m.merchant} | ${m.expected} | ${m.answer} | ${Math.round(m.confidence * 100)}% |`),
  ].join('\n'));
  const reportFile = `${dataDir}report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`;
  writeFileSync(reportFile, [`# Model test, ${new Date().toISOString().slice(0, 10)}`, '', summary, '', ...details].join('\n\n'));
  console.log(`\n${summary}\n\nFull report with merchant names (keep it on the PC): ${reportFile}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  // Not process.exit: on Windows, exiting while fetch's sockets are closing crashes Node (libuv async.c assertion).
  process.exitCode = 1;
});
