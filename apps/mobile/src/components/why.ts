import type { LedgerTransaction } from '@money-plant/matcher';

/** CAT-6: why an entry has its category, in a few words. */
export function whyLabel(tx: Pick<LedgerTransaction, 'categoryReason' | 'confidence' | 'kind'>, aiConfidence?: number | null): string | null {
  if (tx.kind === 'transfer' || tx.kind === 'adjustment') return null;
  switch (tx.categoryReason) {
    case 'user':
      return 'You picked this';
    case 'rule':
      return 'Your rule';
    case 'pattern':
      return 'One of your patterns';
    case 'dictionary':
      return 'Known merchant';
    case 'ai':
      return aiConfidence != null ? `AI guess, ${Math.round(aiConfidence * 100)}% sure` : 'AI guess';
    default:
      return 'Not categorised yet';
  }
}
