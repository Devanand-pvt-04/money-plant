// The AI worker on Deva's PC (decisions 0006 and 0012).
//
//   pnpm --filter @money-plant/ai-worker check   one-off check of Ollama, the model and the queue
//   pnpm --filter @money-plant/ai-worker start   run until stopped (Task Scheduler starts it at login)

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config';
import { runCategorise } from './jobs/categorise';
import { ollama } from './ollama';
import { httpQueue } from './queue';
import { runForever } from './worker';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

/** Well-known merchants, so the check exercises the model without any user's data. */
const SAMPLE = {
  items: [
    { merchant: 'swiggy', label: 'SWIGGY', vpa: 'swiggy@icici', amountBand: '₹100 to ₹500', timeOfDay: 'evening', direction: 'debit' as const },
    { merchant: 'uber india', label: 'UBER INDIA', vpa: null, amountBand: '₹100 to ₹500', timeOfDay: 'morning', direction: 'debit' as const },
    { merchant: 'apollo pharmacy', label: 'APOLLO PHARMACY', vpa: null, amountBand: '₹500 to ₹2,000', timeOfDay: 'afternoon', direction: 'debit' as const },
  ],
  categories: [
    { key: 'food', name: 'Food' },
    { key: 'transport', name: 'Transport' },
    { key: 'health', name: 'Health' },
    { key: 'shopping', name: 'Shopping' },
    { key: 'other', name: 'Other' },
  ],
};

async function check(): Promise<void> {
  const config = readConfig();
  const model = ollama(config);
  const installed = await model.installed();
  const pulled = installed.some((name) => name === config.model || name === `${config.model}:latest`);
  console.log(`Ollama: running at ${config.ollamaUrl}`);
  if (!pulled) throw new Error(`Model ${config.model} isn't pulled. Run: ollama pull ${config.model}`);
  const started = Date.now();
  const sample = await runCategorise(model, SAMPLE);
  console.log(`Model ${config.model}: answered 3 sample merchants in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const r of sample.results) console.log(`  ${r.merchant} → ${r.key ?? 'unknown'} (${Math.round(r.confidence * 100)}%)`);
  const queue = await httpQueue(config).status();
  const waiting = queue.map((row) => `${row.queued} ${row.kind} queued, ${row.running} running`).join('; ');
  console.log(`Queue: reached Supabase with the worker token. ${waiting || 'Nothing waiting.'}`);
}

async function main(command: string | undefined): Promise<void> {
  if (command === 'check') return check();
  if (command !== 'start') throw new Error('Usage: main.ts check | start');
  const config = readConfig();
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop.abort());
  log(`AI worker started with ${config.model}, checking every ${config.pollSeconds} s`);
  await runForever(httpQueue(config), ollama(config), config.pollSeconds, log, stop.signal);
  log('AI worker stopped');
}

main(process.argv[2]).catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
