import { useEffect, useState } from 'react';
import { kvGet, kvSet } from './kv';

const AI_KEY = 'ai.enabled';
const WAITING_KEY = 'ai.waiting';

/**
 * Decision 0012: AI is on once the user accepts the consent screen, and can be
 * switched off in Settings. Off means nothing of theirs is queued for the AI;
 * the shared dictionary still answers.
 */
export async function aiEnabled(): Promise<boolean> {
  return (await kvGet(AI_KEY)) !== 'off';
}

export async function setAiEnabled(on: boolean): Promise<void> {
  await kvSet(AI_KEY, on ? 'on' : 'off');
  if (!on) await setAiWaiting(0);
}

const listeners = new Set<(count: number) => void>();

/** How many merchants are waiting for the AI after the last check, shown in Activity. */
export async function setAiWaiting(count: number): Promise<void> {
  await kvSet(WAITING_KEY, String(count));
  for (const listener of listeners) listener(count);
}

export function useAiWaiting(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    kvGet(WAITING_KEY)
      .then((value) => live && setCount(Number(value ?? 0) || 0))
      .catch(() => {});
    listeners.add(setCount);
    return () => {
      live = false;
      listeners.delete(setCount);
    };
  }, []);
  return count;
}
