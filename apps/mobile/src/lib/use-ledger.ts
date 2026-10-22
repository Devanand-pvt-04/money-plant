import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { onLedgerChange } from './events';

/** Loads local ledger data when the screen is focused and again whenever the ledger changes. */
export function useLedger<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    setData(await loadRef.current());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => onLedgerChange(() => void reload()), [reload]);

  return { data, reload };
}
