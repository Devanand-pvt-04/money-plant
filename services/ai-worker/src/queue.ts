import type { Config } from './config';

export type JobKind = 'categorise' | 'month_review' | 'icon';

export interface Job {
  id: string;
  kind: JobKind;
  payload: unknown;
  attempts: number;
}

export interface QueueCount {
  kind: JobKind;
  queued: number;
  running: number;
}

/** The ai_jobs queue, reached only through the ai-worker edge function. */
export interface Queue {
  claim(limit: number, kinds: readonly JobKind[]): Promise<Job[]>;
  complete(id: string, result: object): Promise<boolean>;
  fail(id: string, error: string): Promise<boolean>;
  status(): Promise<QueueCount[]>;
}

export class QueueError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export function httpQueue(config: Pick<Config, 'supabaseUrl' | 'workerToken'>, fetchImpl: typeof fetch = fetch): Queue {
  const call = async <T>(body: object): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${config.supabaseUrl}/functions/v1/ai-worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Token': config.workerToken },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new QueueError(`Supabase unreachable (${(error as Error).name})`, null);
    }
    if (!response.ok) {
      const reason = response.status === 401 ? 'the worker token was refused' : `HTTP ${response.status}`;
      throw new QueueError(`ai-worker function: ${reason}`, response.status);
    }
    return (await response.json()) as T;
  };
  return {
    claim: async (limit, kinds) => (await call<{ jobs: Job[] }>({ action: 'claim', limit, kinds })).jobs,
    complete: async (id, result) => (await call<{ ok: boolean }>({ action: 'complete', id, result })).ok,
    fail: async (id, error) => (await call<{ ok: boolean }>({ action: 'fail', id, error })).ok,
    status: async () =>
      (await call<{ queue: QueueCount[] }>({ action: 'status' })).queue.map((row) => ({
        kind: row.kind,
        queued: Number(row.queued),
        running: Number(row.running),
      })),
  };
}
