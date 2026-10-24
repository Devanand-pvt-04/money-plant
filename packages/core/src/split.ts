import { paise, type Paise } from './money';

/** SPL-1: how a payment is divided. */
export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

export const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
  equal: 'Equally',
  exact: 'Exact amounts',
  percent: 'Percentages',
  shares: 'Shares',
};

/**
 * One person's part of a split. `value` means: nothing for equal, paise for
 * exact, basis points (1% = 100) for percent, a whole number for shares.
 */
export interface SplitPart {
  id: string;
  value: number;
}

export type SplitError =
  | { code: 'no_parts' }
  | { code: 'bad_value'; id: string }
  | { code: 'exact_mismatch'; difference: number }
  | { code: 'percent_mismatch'; total: number };

/**
 * Divides `total` paise among the parts. Shares always add up to `total`
 * exactly: leftover paise from rounding go one each to the first parts, so
 * ₹100 three ways is ₹33.34, ₹33.33, ₹33.33. Integer arithmetic only.
 */
export function splitAmount(
  total: Paise,
  method: SplitMethod,
  parts: readonly SplitPart[],
): { shares: Map<string, Paise> } | { error: SplitError } {
  if (parts.length === 0) return { error: { code: 'no_parts' } };
  if (!Number.isSafeInteger(total) || total <= 0) return { error: { code: 'bad_value', id: '' } };
  for (const part of parts) {
    if (method !== 'equal' && (!Number.isSafeInteger(part.value) || part.value < 0)) return { error: { code: 'bad_value', id: part.id } };
  }

  if (method === 'exact') {
    const sum = parts.reduce((s, p) => s + p.value, 0);
    if (sum !== total) return { error: { code: 'exact_mismatch', difference: total - sum } };
    return { shares: new Map(parts.map((p) => [p.id, paise(p.value)])) };
  }
  if (method === 'percent') {
    const sum = parts.reduce((s, p) => s + p.value, 0);
    if (sum !== 10_000) return { error: { code: 'percent_mismatch', total: sum } };
  }
  const weights = parts.map((p) => (method === 'equal' ? 1 : p.value));
  const weightTotal = weights.reduce((s, w) => s + w, 0);
  if (weightTotal <= 0) return { error: { code: 'bad_value', id: parts[0]!.id } };

  // Largest remainder: floor each share, then hand out the leftover paise in order.
  const floors = weights.map((w) => Number((BigInt(total) * BigInt(w)) / BigInt(weightTotal)));
  let leftover = total - floors.reduce((s, f) => s + f, 0);
  const shares = new Map<string, Paise>();
  parts.forEach((part, i) => {
    const extra = leftover > 0 && weights[i]! > 0 ? 1 : 0;
    leftover -= extra;
    shares.set(part.id, paise(floors[i]! + extra));
  });
  return { shares };
}
