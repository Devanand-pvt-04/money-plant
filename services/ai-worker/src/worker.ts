import { runCategorise } from './jobs/categorise';
import type { Model } from './ollama';
import { QueueError, type Job, type JobKind, type Queue } from './queue';

type Handler = (model: Model, payload: unknown) => Promise<object>;

/** The job kinds this worker can run. Month reviews and icons join in later builds (decision 0012). */
export const handlers: Partial<Record<JobKind, Handler>> = {
  categorise: runCategorise,
};

export interface Log {
  (line: string): void;
}

export const BATCH = 5;

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
  for (const job of jobs) await runJob(queue, model, job, log, now);
  return jobs.length;
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
