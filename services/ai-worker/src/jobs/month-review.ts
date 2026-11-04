import type { MonthReviewFacts, MonthReviewWriteUp } from '@money-plant/core';
import type { ChatMessage, Model } from '../ollama';

export type MonthReviewResult = MonthReviewWriteUp;
type ReviewCause = MonthReviewWriteUp['causes'][number];

const MAX_SUMMARY = 600;
const MAX_CAUSE = 300;
/** A figure in the text may be rounded by this much and still count as one from the facts. */
const ROUNDING = 0.02;

const SYSTEM = `You write a short month review for a personal finance app used in India.
You get the month's facts as JSON. Amounts are whole rupees.
Write:
- "summary": 2 or 3 plain sentences on how the month went: spending against the budget and income, and the one or two things that stand out. Speak to the user as "you".
- "causes": for each category in "overspends", one sentence on why it went over, naming the payees or entries behind it, and the IDs of the "largest" entries you mention in "transactionIds".
Rules: use only figures from the facts, written as ₹ with Indian digit grouping (₹12,500). Don't add, subtract or invent any figure. Don't give investment or tax advice. No greetings, no emoji.`;

export function parseFacts(payload: unknown): MonthReviewFacts {
  const facts = payload as Partial<MonthReviewFacts> | null;
  if (!facts || typeof facts.month !== 'string' || typeof facts.spent !== 'number' || !Array.isArray(facts.overspends) || !Array.isArray(facts.biggest)) {
    throw new Error('bad payload');
  }
  return facts as MonthReviewFacts;
}

export function reviewPrompt(facts: MonthReviewFacts): { messages: ChatMessage[]; schema: object } {
  return {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(facts) },
    ],
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        causes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              text: { type: 'string' },
              transactionIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['category', 'text', 'transactionIds'],
          },
        },
      },
      required: ['summary', 'causes'],
    },
  };
}

/** Every rupee figure in the facts: the only ones the write-up may quote. */
export function factFigures(facts: MonthReviewFacts): number[] {
  const figures: number[] = [];
  const walk = (value: unknown, key: string) => {
    if (typeof value === 'number' && key !== 'count') figures.push(Math.abs(value));
    else if (Array.isArray(value)) for (const item of value) walk(item, key);
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(facts, '');
  return figures;
}

/** ₹ or Rs figures in a text, as numbers (₹1.2 lakh and ₹12k included). */
export function quotedFigures(text: string): number[] {
  const figures: number[] = [];
  for (const match of text.matchAll(/(?:₹|\brs\.?|\binr)\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b|lakhs?\b|l\b)?/gi)) {
    const value = Number(match[1]!.replace(/,/g, ''));
    const unit = match[2]?.toLowerCase();
    figures.push(unit === 'k' ? value * 1000 : unit ? value * 100_000 : value);
  }
  return figures;
}

const known = (figure: number, figures: readonly number[]) => figures.some((f) => Math.abs(figure - f) <= Math.max(1, Math.abs(f) * ROUNDING));

/**
 * The checks in decision 0012: a summary that quotes a figure not in the facts
 * fails the job (it is retried once), and a cause that does, or that names a
 * category or transaction ID not in the facts, is dropped.
 */
export function checkReview(answer: unknown, facts: MonthReviewFacts): MonthReviewResult {
  const raw = answer as { summary?: unknown; causes?: unknown } | null;
  const summary = typeof raw?.summary === 'string' ? raw.summary.trim() : '';
  if (summary.length === 0) throw new Error('The model answer had no summary');
  if (summary.length > MAX_SUMMARY) throw new Error('The summary was too long');
  const figures = factFigures(facts);
  if (!quotedFigures(summary).every((f) => known(f, figures))) throw new Error('The summary quoted a figure not in the facts');

  const causes: ReviewCause[] = [];
  for (const item of Array.isArray(raw?.causes) ? raw.causes : []) {
    const cause = item as Partial<ReviewCause>;
    const overspend = facts.overspends.find((o) => o.category === cause.category);
    const text = typeof cause.text === 'string' ? cause.text.trim() : '';
    if (!overspend || text.length === 0 || text.length > MAX_CAUSE) continue;
    if (causes.some((c) => c.category === overspend.category)) continue;
    const ids = Array.isArray(cause.transactionIds) ? cause.transactionIds : [];
    if (!ids.every((id) => overspend.largest.some((entry) => entry.id === id))) continue;
    if (!quotedFigures(text).every((f) => known(f, figures))) continue;
    causes.push({ category: overspend.category, text, transactionIds: [...new Set(ids as string[])] });
  }
  return { summary, causes };
}

export async function runMonthReview(model: Model, payload: unknown): Promise<MonthReviewResult> {
  const facts = parseFacts(payload);
  const { messages, schema } = reviewPrompt(facts);
  return checkReview(await model.json(messages, schema), facts);
}
