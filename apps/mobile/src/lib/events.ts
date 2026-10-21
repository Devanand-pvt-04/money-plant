const listeners = new Set<() => void>();

/** Calls `listener` after the ledger changes (a capture, a review action, a sync). Returns an unsubscribe function. */
export function onLedgerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyLedgerChange(): void {
  for (const listener of listeners) listener();
}
