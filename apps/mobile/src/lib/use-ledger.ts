import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { onLedgerChange } from './events';
import { timed } from './perf';

/** Focusing a screen again reloads it anyway after this long, for data that changes with the clock. */
const FRESH_MS = 30_000;
/** Ledger changes closer together than this (an SMS import, a sync) cause one reload. */
const SETTLE_MS = 150;

/**
 * Loads local ledger data when the screen is focused and again when the
 * ledger changes. A screen out of view (a hidden tab, one under another
 * screen) doesn't reload on each change; it only notes that it is stale and
 * reloads when it comes back into view. `name` labels the load in the speed log.
 */
export function useLedger<T>(load: () => Promise<T>, initial: T, name?: string) {
  const [data, setData] = useState<T>(initial);
  const loadRef = useRef(load);
  loadRef.current = load;
  const focused = useRef(false);
  const stale = useRef(true);
  const loadedAt = useRef(0);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const mine = ++sequence.current;
    stale.current = false;
    loadedAt.current = Date.now();
    const next = await timed(name ?? 'screen', () => loadRef.current());
    // A slower, older load must not overwrite a newer one.
    if (mine === sequence.current) setData(next);
  }, [name]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (stale.current || Date.now() - loadedAt.current > FRESH_MS) void reload();
      return () => {
        focused.current = false;
      };
    }, [reload]),
  );

  useEffect(() => {
    const unsubscribe = onLedgerChange(() => {
      stale.current = true;
      if (!focused.current || timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (focused.current && stale.current) void reload();
      }, SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload]);

  return { data, reload };
}
