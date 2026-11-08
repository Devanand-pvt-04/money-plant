/**
 * Sync helpers that don't touch the phone's database or the network, so they
 * can be tested on their own.
 */

/**
 * True when the server refused the data itself (a check, a foreign key, row-level
 * security, a bad value), so sending it again unchanged fails the same way.
 * False for anything that may pass on a retry: offline, a timeout, an expired
 * sign-in, the server being busy.
 */
export function isRejection(error: unknown): boolean {
  const raw = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const code = typeof raw === 'string' ? raw : '';
  // Postgres classes: 22 bad data, 23 constraint broken, 42 not allowed or malformed, P0 raised by our functions.
  return /^(22|23|42|P0)[0-9A-Z]{3}$/.test(code);
}

export interface BatchOutcome<T> {
  /** Items the server accepted. */
  sent: T[];
  /** Items the server refused, each with its error. */
  rejected: { item: T; error: unknown }[];
}

/**
 * Sends `items` in one call. If the server refuses the batch, sends them one
 * at a time instead, so one bad item can't hold back the rest. Any failure
 * that isn't a refusal (offline, say) is thrown, and nothing is set aside.
 */
export async function pushWithFallback<T>(
  items: readonly T[],
  push: (batch: readonly T[]) => Promise<{ error: unknown }>,
  rejected: (error: unknown) => boolean,
): Promise<BatchOutcome<T>> {
  if (items.length === 0) return { sent: [], rejected: [] };
  const { error } = await push(items);
  if (!error) return { sent: [...items], rejected: [] };
  if (!rejected(error)) throw error;
  if (items.length === 1) return { sent: [], rejected: [{ item: items[0]!, error }] };
  const outcome: BatchOutcome<T> = { sent: [], rejected: [] };
  for (const item of items) {
    const single = await push([item]);
    if (!single.error) outcome.sent.push(item);
    else if (rejected(single.error)) outcome.rejected.push({ item, error: single.error });
    else throw single.error;
  }
  return outcome;
}
