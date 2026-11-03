import type { AiCategoriseItem } from '@money-plant/categoriser';
import type { ChatMessage, Model } from '../ollama';

export interface CategoriseCategory {
  key: string;
  name: string;
}

export interface CategorisePayload {
  items: AiCategoriseItem[];
  categories: CategoriseCategory[];
}

export interface CategoriseAnswer {
  merchant: string;
  /** A key from the payload's categories, or null when the model couldn't tell. */
  key: string | null;
  /** The merchant's display name as the model would write it. */
  name: string | null;
  confidence: number;
}

export interface CategoriseResult {
  results: CategoriseAnswer[];
}

const UNKNOWN = 'unknown';
const MAX_ITEMS = 25;

const SYSTEM = `You categorise payments for an Indian personal finance app.
Each payment has a merchant label as the bank printed it, sometimes a UPI ID, a rough amount and a time of day.
For each one, pick the single best category key from the list, or "${UNKNOWN}" if you can't tell what the business sells.
Also give the merchant's everyday name (for example "Swiggy" for "SWIGGY INSTAMART BANGALORE") and your confidence from 0 to 1.
Be strict with confidence: 0.9 or more only for a business you clearly recognise. A cryptic code, a person's name or a generic word like "enterprises" or "traders" gets 0.5 or less.
Answer for every merchant in the input, using its "merchant" value unchanged.`;

/** Reads and checks a categorise job's payload, which comes from the categorise edge function. */
export function parsePayload(payload: unknown): CategorisePayload {
  const value = payload as Partial<CategorisePayload> | null;
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.categories)) throw new Error('bad payload');
  const items = value.items.filter((item) => typeof item?.merchant === 'string' && item.merchant.length > 0).slice(0, MAX_ITEMS);
  const categories = value.categories.filter((c) => typeof c?.key === 'string' && typeof c?.name === 'string');
  if (items.length === 0 || categories.length === 0) throw new Error('bad payload');
  return { items, categories };
}

export function categorisePrompt(payload: CategorisePayload): { messages: ChatMessage[]; schema: object } {
  const keys = payload.categories.map((c) => c.key);
  const categories = payload.categories.map((c) => `${c.key}: ${c.name}`).join('\n');
  const payments = payload.items.map((item) => ({
    merchant: item.merchant,
    label: item.label,
    upi: item.vpa ?? undefined,
    amount: item.amountBand,
    time: item.timeOfDay,
    direction: item.direction === 'credit' ? 'money in' : 'money out',
  }));
  return {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Categories:\n${categories}\n\nPayments:\n${JSON.stringify(payments, null, 1)}` },
    ],
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              merchant: { type: 'string' },
              key: { type: 'string', enum: [...keys, UNKNOWN] },
              name: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['merchant', 'key', 'name', 'confidence'],
          },
        },
      },
      required: ['results'],
    },
  };
}

/**
 * Keeps only what the model may say: one answer per merchant that was asked
 * about, a key from the list, a short name and a confidence between 0 and 1.
 * A merchant the model skipped comes back as unknown.
 */
export function checkAnswer(payload: CategorisePayload, answer: unknown): CategoriseResult {
  const keys = new Set(payload.categories.map((c) => c.key));
  const raw = (answer as { results?: unknown } | null)?.results;
  if (!Array.isArray(raw)) throw new Error('The model answer had no results');
  const byMerchant = new Map<string, CategoriseAnswer>();
  for (const entry of raw as Partial<Record<keyof CategoriseAnswer, unknown>>[]) {
    if (typeof entry?.merchant !== 'string' || byMerchant.has(entry.merchant)) continue;
    const key = typeof entry.key === 'string' && keys.has(entry.key) ? entry.key : null;
    const confidence = typeof entry.confidence === 'number' && Number.isFinite(entry.confidence) ? Math.min(1, Math.max(0, entry.confidence)) : 0;
    const name = typeof entry.name === 'string' ? entry.name.replace(/\d{6,}/g, '').trim().slice(0, 80) || null : null;
    byMerchant.set(entry.merchant, { merchant: entry.merchant, key, name, confidence: key ? confidence : 0 });
  }
  if (!payload.items.some((item) => byMerchant.has(item.merchant))) throw new Error('The model answer named none of the merchants');
  return {
    results: payload.items.map((item) => byMerchant.get(item.merchant) ?? { merchant: item.merchant, key: null, name: null, confidence: 0 }),
  };
}

export async function runCategorise(model: Model, payload: unknown): Promise<CategoriseResult> {
  const parsed = parsePayload(payload);
  const { messages, schema } = categorisePrompt(parsed);
  return checkAnswer(parsed, await model.json(messages, schema));
}
