import type { Paise } from '@money-plant/core';

const BANDS: readonly [number, string][] = [
  [10_000, 'under ₹100'],
  [50_000, '₹100 to ₹500'],
  [200_000, '₹500 to ₹2,000'],
  [1_000_000, '₹2,000 to ₹10,000'],
  [5_000_000, '₹10,000 to ₹50,000'],
];

/** The AI gets an amount band, never the exact amount. */
export function amountBand(amount: Paise): string {
  const abs = Math.abs(amount);
  return BANDS.find(([limit]) => abs < limit)?.[1] ?? 'over ₹50,000';
}

/** "morning" and so on, from local minutes after midnight. */
export function timeOfDay(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * A UPI ID is sent to the AI only when it can't identify a person: no phone
 * number and no long digit run (account numbers).
 */
export function shareableVpa(vpa: string | null): string | null {
  if (!vpa) return null;
  return /\d{6,}/.test(vpa) ? null : vpa.toLowerCase();
}

/** One merchant the phone could not categorise locally, as sent to the categorise edge function. */
export interface AiCategoriseItem {
  /** Normalised merchant name; also the cache key. */
  merchant: string;
  /** The label as printed, without digits that could be account or phone numbers. */
  label: string;
  vpa: string | null;
  amountBand: string;
  timeOfDay: string;
  direction: 'debit' | 'credit';
}

export interface AiCategoriseResult {
  merchant: string;
  /** A standard category key, or null when the function had no answer. */
  key: string | null;
  name: string | null;
  confidence: number;
  source: 'dictionary' | 'ai';
}
