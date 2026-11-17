const listeners = new Set<() => void>();
let generation = 0;

/** Goes up on every ledger change, so a result worked out before one is known to be old. */
export function ledgerGeneration(): number {
  return generation;
}

/** Calls `listener` after the ledger changes (a capture, a review action, a sync). Returns an unsubscribe function. */
export function onLedgerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyLedgerChange(): void {
  generation++;
  for (const listener of listeners) listener();
}
