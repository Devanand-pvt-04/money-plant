import { runCategorise, type CategorisePayload } from './jobs/categorise';
import { runIcon } from './jobs/icon';
import { runMonthReview } from './jobs/month-review';
import type { Model } from './ollama';
import { QueueError, type Job, type JobKind, type Queue } from './queue';

type Handler = (model: Model, payload: unknown) => Promise<object>;

/** The job kinds this worker can run (decision 0012). */
export const handlers: Partial<Record<JobKind, Handler>> = {
  categorise: runCategorise,
  icon: runIcon,
  month_review: runMonthReview,
};

export interface Log {
  (line: string): void;
}

/** Jobs claimed at a time (the database hands out at most 20). */
export const BATCH = 20;

/**
 * Claims one batch and runs it. Returns how many jobs it claimed, so the loop
 * can ask again straight away while the queue has work. Logs job IDs and
 * timings only: never payloads or answers, which hold users' merchant names.
 */
export async function runOnce(queue: Queue, model: Model, log: Log, now: () => number = Date.now): Promise<number> {
  // Claim nothing while Ollama is down, so jobs aren't used up failing.
  try {
    await model.installed();
  } catch (error) {
    throw new Error(`Ollama is not answering (${(error as Error).message})`);
  }
  const kinds = Object.keys(handlers) as JobKind[];
  const jobs = await queue.claim(BATCH, kinds);
  // Each categorise job is one merchant; jobs that share a category list go to the model together.
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    if (job.kind !== 'categorise') {
      await runJob(queue, model, job, log, now);
      continue;
    }
    const key = JSON.stringify((job.payload as Partial<CategorisePayload> | null)?.categories ?? null);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  for (const group of groups.values()) await runCategoriseGroup(queue, model, group, log, now);
  return jobs.length;
}

async function runCategoriseGroup(queue: Queue, model: Model, jobs: readonly Job[], log: Log, now: () => number): Promise<void> {
  if (jobs.length === 1) return runJob(queue, model, jobs[0]!, log, now);
  const started = now();
  const payloads = jobs.map((job) => job.payload as Partial<CategorisePayload> | null);
  const merged = { items: payloads.flatMap((p) => (Array.isArray(p?.items) ? p.items : [])), categories: payloads[0]?.categories };
  let answers;
  try {
    answers = (await runCategorise(model, merged)).results;
  } catch (error) {
    // The whole batch failed: run them one at a time instead, so one odd merchant can't sink the rest.
    log(`${jobs.length} categorise jobs together failed (${(error as Error).message.slice(0, 120)}); running them one by one`);
    for (const job of jobs) await runJob(queue, model, job, log, now);
    return;
  }
  for (const job of jobs) {
    const merchant = (job.payload as Partial<CategorisePayload> | null)?.items?.[0]?.merchant;
    const answer = answers.find((a) => a.merchant === merchant);
    if (answer) await queue.complete(job.id, { results: [answer] });
    else await queue.fail(job.id, 'bad payload');
  }
  log(`${jobs.length} categorise jobs done together in ${now() - started} ms`);
}

async function runJob(queue: Queue, model: Model, job: Job, log: Log, now: () => number): Promise<void> {
  const started = now();
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    const result = await handler(model, job.payload);
    await queue.complete(job.id, result);
    log(`${job.id} ${job.kind} done in ${now() - started} ms`);
  } catch (error) {
    // Losing Supabase mid-job: the job times out and goes back to the queue on its own.
    if (error instanceof QueueError) throw error;
    const reason = (error as Error).message.slice(0, 200);
    log(`${job.id} ${job.kind} failed (attempt ${job.attempts}): ${reason}`);
    await queue.fail(job.id, reason);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Polls every `pollSeconds` while the queue is empty and straight away while
 * it has work. When Supabase or Ollama can't be reached (no internet, Ollama
 * still starting) it waits longer each time, up to 5 minutes, and keeps going.
 */
export async function runForever(queue: Queue, model: Model, pollSeconds: number, log: Log, signal?: AbortSignal): Promise<void> {
  let backoff = 0;
  while (!signal?.aborted) {
    try {
      const claimed = await runOnce(queue, model, log);
      if (backoff > 0) log('Connected again');
      backoff = 0;
      if (claimed > 0) continue;
      await sleep(pollSeconds * 1000, signal);
    } catch (error) {
      if (error instanceof QueueError && error.status === 401) throw error;
      backoff = Math.min(backoff === 0 ? pollSeconds : backoff * 2, 300);
      log(`${(error as Error).message}; trying again in ${backoff} s`);
      await sleep(backoff * 1000, signal);
    }
  }
}
