import * as Crypto from 'expo-crypto';
import { wholeRupees, type MonthKey, type MonthReviewFacts, type MonthReviewWriteUp, type Paise } from '@money-plant/core';
import { formatMonth } from '@/components/format';
import { aiEnabled } from './ai-settings';
import { currentMonth } from './budgets';
import { kvGet, kvSet } from './kv';
import { lastMonth, monthReview, type MonthReview } from './review';
import { supabase } from './supabase';

/**
 * Decision 0012, build 4: the AI write-up above the month review. The phone
 * sends the facts it already shows as a month_review job; the worker on
 * Deva's PC writes a summary and a cause per overspend and checks every
 * figure against those facts. The write-up is shown only while the facts it
 * was written from still match the numbers on screen.
 */
export type AiReview =
  | { status: 'off' }
  | { status: 'waiting' }
  | { status: 'failed' }
  | { status: 'done'; writeUp: MonthReviewWriteUp };

interface Stored {
  /** The facts the job was queued with, as sent. */
  facts: string;
  jobId: string;
  writeUp?: MonthReviewWriteUp;
  failed?: boolean;
}

const storeKey = (month: MonthKey) => `ai.review.${month}`;
const CHECKED_KEY = 'ai.review.checked';
/** How often a catch-up looks at last month's write-up. */
const CHECK_EVERY_MS = 60 * 60_000;

const rupees = (amount: Paise) => wholeRupees(amount);
/** Long digit runs (account or phone numbers in a payee label) never leave the phone. */
const payee = (name: string | null) => (name ?? 'Unknown').replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Unknown';

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The facts for the AI: the same figures the review screen shows, in whole rupees. */
export function reviewFacts(review: MonthReview): MonthReviewFacts {
  return {
    month: formatMonth(review.month),
    spent: rupees(review.spent),
    budget: review.budget === null ? null : rupees(review.budget),
    inBudgets: rupees(review.inBudgets),
    outside: rupees(review.outside),
    income: rupees(review.income),
    kept: wholeRupees((review.income - review.spent) as Paise),
    budgetLeft: review.budget === null ? null : wholeRupees((review.budget - review.inBudgets) as Paise),
    overspends: review.overspends.map((o) => ({
      category: o.category.name,
      spent: rupees(o.spent),
      limit: rupees(o.limit),
      over: rupees(o.over),
      usual: o.average > 0 ? rupees(o.average) : null,
      payees: o.payees.map((p) => ({ payee: payee(p.merchant), amount: rupees(p.amount), count: p.count })),
      largest: o.largest.map((e) => ({ id: e.transactionId, payee: payee(e.counterparty), amount: rupees(e.amount), date: localDate(e.occurredAt) })),
    })),
    biggest: review.biggest.map((b) => ({ category: b.category.name, spent: rupees(b.spent), usual: b.usual > 0 ? rupees(b.usual) : null })),
    uncategorised: review.uncategorised ? { count: review.uncategorised.count, amount: rupees(review.uncategorised.amount) } : null,
    suggestions: review.suggestions.map((s) => ({
      category: s.category.name,
      kind: s.kind,
      current: s.current === null ? null : rupees(s.current),
      suggested: rupees(s.suggested),
    })),
  };
}

async function readStored(month: MonthKey): Promise<Stored | null> {
  try {
    return JSON.parse((await kvGet(storeKey(month))) ?? 'null') as Stored | null;
  } catch {
    return null;
  }
}

const writeStored = (month: MonthKey, stored: Stored) => kvSet(storeKey(month), JSON.stringify(stored));

function asWriteUp(result: unknown): MonthReviewWriteUp | null {
  const r = result as Partial<MonthReviewWriteUp> | null;
  if (!r || typeof r.summary !== 'string' || !Array.isArray(r.causes)) return null;
  return {
    summary: r.summary,
    causes: r.causes.filter((c) => c && typeof c.category === 'string' && typeof c.text === 'string' && Array.isArray(c.transactionIds)),
  };
}

/** Where a queued job stands, or null when it can't be read (offline) and should be asked again later. */
async function jobState(jobId: string): Promise<{ open: boolean; writeUp: MonthReviewWriteUp | null; missing: boolean } | null> {
  const { data, error } = await supabase.from('ai_jobs').select('status, result').eq('id', jobId).maybeSingle();
  if (error) return null;
  if (!data) return { open: false, writeUp: null, missing: true };
  const open = data.status === 'queued' || data.status === 'running';
  return { open, writeUp: data.status === 'done' ? asWriteUp(data.result) : null, missing: false };
}

async function queue(month: MonthKey, facts: string): Promise<AiReview> {
  const jobId = Crypto.randomUUID();
  const { error } = await supabase.from('ai_jobs').insert({ id: jobId, kind: 'month_review', payload: JSON.parse(facts) });
  if (error) return { status: 'waiting' };
  await writeStored(month, { facts, jobId });
  return { status: 'waiting' };
}

/**
 * The write-up for a finished month: the saved one when the facts are
 * unchanged, else the job's answer, else a new job. One job per month is open
 * at a time; when the numbers change while it runs, the next look queues again.
 */
export async function aiReviewFor(review: MonthReview): Promise<AiReview> {
  const month = review.month;
  const empty = review.spent === 0 && review.income === 0;
  if (empty || month >= currentMonth() || !(await aiEnabled())) return { status: 'off' };
  const facts = JSON.stringify(reviewFacts(review));
  const stored = await readStored(month);
  if (!stored) return queue(month, facts);

  const same = stored.facts === facts;
  if (same && stored.writeUp) return { status: 'done', writeUp: stored.writeUp };
  if (same && stored.failed) return { status: 'failed' };
  if (!stored.writeUp && !stored.failed) {
    const state = await jobState(stored.jobId);
    if (!state || state.open) return { status: 'waiting' };
    if (!state.missing) {
      const finished: Stored = state.writeUp ? { ...stored, writeUp: state.writeUp } : { ...stored, failed: true };
      await writeStored(month, finished);
      if (same) return state.writeUp ? { status: 'done', writeUp: state.writeUp } : { status: 'failed' };
    }
  }
  // The numbers moved since the job was queued (an entry recategorised, a late SMS): write it again.
  return queue(month, facts);
}

/**
 * On catch-up, at most hourly: queues last month's write-up once the month
 * has ended, so it is usually ready by the 9 am review notification.
 */
export async function refreshAiReview(): Promise<void> {
  if (!(await aiEnabled())) return;
  const last = Number((await kvGet(CHECKED_KEY)) ?? 0);
  if (Date.now() - last < CHECK_EVERY_MS) return;
  await kvSet(CHECKED_KEY, String(Date.now()));
  await aiReviewFor(await monthReview(lastMonth()));
}
