import { describe, expect, it } from 'vitest';
import type { Model } from './ollama';
import { QueueError, httpQueue, type Job, type JobKind, type Queue } from './queue';
import { runForever, runOnce } from './worker';

const categoriseJob: Job = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'categorise',
  attempts: 1,
  payload: {
    items: [{ merchant: 'swiggy', label: 'SWIGGY', vpa: null, amountBand: 'under ₹100', timeOfDay: 'evening', direction: 'debit' }],
    categories: [{ key: 'food', name: 'Food' }],
  },
};

function fakeQueue(jobs: Job[]) {
  const calls: { action: string; id?: string; kinds?: readonly JobKind[]; result?: object; error?: string }[] = [];
  const queue: Queue = {
    claim: async (limit, kinds) => {
      calls.push({ action: 'claim', kinds });
      return jobs.splice(0, limit);
    },
    complete: async (id, result) => {
      calls.push({ action: 'complete', id, result });
      return true;
    },
    fail: async (id, error) => {
      calls.push({ action: 'fail', id, error });
      return true;
    },
    status: async () => [],
  };
  return { queue, calls };
}

const model = (answer: () => unknown, up = true): Model => ({
  json: async () => answer(),
  installed: async () => {
    if (!up) throw new Error('ECONNREFUSED');
    return ['qwen'];
  },
});

describe('runOnce', () => {
  it('claims only the kinds it can run, then completes each job', async () => {
    const { queue, calls } = fakeQueue([categoriseJob]);
    const lines: string[] = [];
    const claimed = await runOnce(queue, model(() => ({ results: [{ merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 0.9 }] })), (l) => lines.push(l));
    expect(claimed).toBe(1);
    expect(calls[0]).toEqual({ action: 'claim', kinds: ['categorise', 'icon'] });
    expect(calls[1]).toEqual({
      action: 'complete',
      id: categoriseJob.id,
      result: { results: [{ merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 0.9 }] },
    });
    // Logs carry the job ID and timing, never merchant names.
    expect(lines.join('\n')).not.toContain('swiggy');
  });

  it('reports a bad answer as a failure so the job is retried', async () => {
    const { queue, calls } = fakeQueue([categoriseJob]);
    await runOnce(queue, model(() => 'not json'), () => {});
    expect(calls[1]).toMatchObject({ action: 'fail', id: categoriseJob.id, error: 'The model answer had no results' });
  });

  it('claims nothing while Ollama is down', async () => {
    const { queue, calls } = fakeQueue([categoriseJob]);
    await expect(runOnce(queue, model(() => ({}), false), () => {})).rejects.toThrow('Ollama is not answering');
    expect(calls).toEqual([]);
  });
  it('asks the model once for categorise jobs that share a category list', async () => {
    const job = (id: string, merchant: string): Job => ({
      ...categoriseJob,
      id,
      payload: { items: [{ merchant, label: merchant, vpa: null, amountBand: 'under ₹100', timeOfDay: 'evening', direction: 'debit' }], categories: [{ key: 'food', name: 'Food' }] },
    });
    const { queue, calls } = fakeQueue([job('00000000-0000-4000-8000-000000000002', 'swiggy'), job('00000000-0000-4000-8000-000000000003', 'zomato')]);
    let asked = 0;
    const answer = () => {
      asked++;
      return { results: [
        { merchant: 'zomato', key: 'food', name: 'Zomato', confidence: 0.9 },
        { merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 0.85 },
      ] };
    };
    expect(await runOnce(queue, model(answer), () => {})).toBe(2);
    expect(asked).toBe(1);
    expect(calls.slice(1)).toEqual([
      { action: 'complete', id: '00000000-0000-4000-8000-000000000002', result: { results: [{ merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 0.85 }] } },
      { action: 'complete', id: '00000000-0000-4000-8000-000000000003', result: { results: [{ merchant: 'zomato', key: 'food', name: 'Zomato', confidence: 0.9 }] } },
    ]);
  });

  it('runs an icon job', async () => {
    const { queue, calls } = fakeQueue([{ id: '00000000-0000-4000-8000-000000000004', kind: 'icon', attempts: 1, payload: { name: 'Badminton' } }]);
    await runOnce(queue, model(() => ({ words: ['Badminton', 'shuttlecock', 'racket 2', 'badminton'] })), () => {});
    expect(calls[1]).toEqual({ action: 'complete', id: '00000000-0000-4000-8000-000000000004', result: { words: ['badminton', 'shuttlecock'] } });
  });
});

describe('runForever', () => {
  it('stops at once when the worker token is refused', async () => {
    const queue: Queue = {
      claim: async () => {
        throw new QueueError('ai-worker function: the worker token was refused', 401);
      },
      complete: async () => true,
      fail: async () => true,
      status: async () => [],
    };
    await expect(runForever(queue, model(() => ({})), 30, () => {})).rejects.toThrow('refused');
  });

  it('keeps going through a dropped connection until stopped', async () => {
    const stop = new AbortController();
    const lines: string[] = [];
    let claims = 0;
    const queue: Queue = {
      claim: async () => {
        claims++;
        stop.abort();
        throw new QueueError('Supabase unreachable (TypeError)', null);
      },
      complete: async () => true,
      fail: async () => true,
      status: async () => [],
    };
    await runForever(queue, model(() => ({})), 30, (l) => lines.push(l), stop.signal);
    expect(claims).toBe(1);
    expect(lines[0]).toBe('Supabase unreachable (TypeError); trying again in 30 s');
  });
});

describe('httpQueue', () => {
  it('sends the worker token and the action to the ai-worker function', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ jobs: [categoriseJob] }), { status: 200 });
    }) as unknown as typeof fetch;
    const queue = httpQueue({ supabaseUrl: 'https://example.supabase.co', workerToken: 'secret' }, fakeFetch);
    expect(await queue.claim(5, ['categorise'])).toEqual([categoriseJob]);
    expect(requests[0]!.url).toBe('https://example.supabase.co/functions/v1/ai-worker');
    expect((requests[0]!.init.headers as Record<string, string>)['X-Worker-Token']).toBe('secret');
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual({ action: 'claim', limit: 5, kinds: ['categorise'] });
  });

  it('names a refused token clearly', async () => {
    const fakeFetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const queue = httpQueue({ supabaseUrl: 'https://example.supabase.co', workerToken: 'wrong' }, fakeFetch);
    await expect(queue.status()).rejects.toMatchObject({ status: 401, message: 'ai-worker function: the worker token was refused' });
  });
});
