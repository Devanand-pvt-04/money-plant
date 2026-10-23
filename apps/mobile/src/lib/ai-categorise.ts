import { and, inArray, isNull } from 'drizzle-orm';
import {
  amountBand,
  localTime,
  normaliseMerchant,
  shareableVpa,
  timeOfDay,
  type AiCategoriseItem,
  type AiCategoriseResult,
} from '@money-plant/categoriser';
import { merchantCache, transactions } from '@money-plant/db-schema';
import { MERCHANT_RECHECK_DAYS, entryFeatures, flatten, listCategories, ownedAccountIds, recategoriseHistory } from './categories';
import { getDb } from './db';
import { loadTransactions } from './ledger-store';
import { supabase } from './supabase';

const BATCH = 25;
const DAY = 24 * 60 * 60 * 1000;

/** Digits that could be an account or phone number never leave the phone. */
const cleanLabel = (label: string) => label.replace(/\d{4,}/g, ' ').replace(/\s+/g, ' ').trim();

export interface AiRunResult {
  asked: number;
  categorised: number;
  capped: boolean;
}

let running: Promise<AiRunResult> | null = null;

/**
 * The last layer of CAT-2. Collects merchants on uncategorised business
 * entries that the phone hasn't asked about recently, asks the categorise
 * edge function (shared dictionary first, then Claude), caches the answers on
 * the phone and re-runs the categoriser over those entries. Payments to
 * people are never sent (CAT-4). Safe to call often; concurrent calls share one run.
 */
export function categoriseWithAi(): Promise<AiRunResult> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<AiRunResult> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { asked: 0, categorised: 0, capped: false };
  const db = await getDb();
  const owned = ownedAccountIds(db);
  const cached = new Map(db.select().from(merchantCache).all().map((row) => [row.merchant, row]));
  const recheckBefore = Date.now() - MERCHANT_RECHECK_DAYS * DAY;

  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), isNull(transactions.categoryReason), inArray(transactions.kind, ['expense', 'income'])))
    .all();
  const items = new Map<string, AiCategoriseItem>();
  for (const tx of loadTransactions(db, rows)) {
    if (!tx.counterparty || tx.userSetFields.includes('category')) continue;
    const features = entryFeatures(tx, owned);
    if (!features || features.payeeKind === 'person') continue;
    const merchant = normaliseMerchant(tx.counterparty);
    if (merchant.length < 2 || /\d{6,}/.test(merchant) || items.has(merchant)) continue;
    const known = cached.get(merchant);
    if (known && (known.categoryKey !== null || Date.parse(known.checkedAt) > recheckBefore)) continue;
    const { minuteOfDay } = localTime(tx.occurredAt, -new Date(tx.occurredAt).getTimezoneOffset());
    items.set(merchant, {
      merchant,
      label: cleanLabel(tx.counterparty),
      vpa: shareableVpa(features.vpa),
      amountBand: amountBand(features.amount),
      timeOfDay: timeOfDay(minuteOfDay),
      direction: features.direction,
    });
  }

  // Cached answers from an earlier run may not have been applied yet.
  let categorised = await recategoriseHistory({ uncategorisedOnly: true });
  if (items.size === 0) return { asked: 0, categorised, capped: false };

  const categories = flatten(await listCategories())
    .filter((c) => !c.system && c.key && !c.key.endsWith('custom'))
    .map((c) => ({ key: c.key!, name: c.name }));
  const pending = [...items.values()];
  let capped = false;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const { data: response, error } = await supabase.functions.invoke<{ results: AiCategoriseResult[]; capped?: boolean; retryLater?: boolean }>(
      'categorise',
      { body: { items: batch, categories } },
    );
    if (error || !response) throw error ?? new Error('No answer from the categorise function');
    const checkedAt = new Date().toISOString();
    const answered = new Map(response.results.map((r) => [r.merchant, r]));
    db.transaction((t) => {
      for (const item of batch) {
        const result = answered.get(item.merchant);
        // When the function was capped or busy, unanswered merchants are asked again next time.
        if (!result && (response.capped || response.retryLater)) continue;
        const values = {
          categoryKey: result?.key ?? null,
          displayName: result?.name ?? null,
          confidence: result?.confidence ?? 0,
          source: result?.source ?? 'ai',
          checkedAt,
        };
        t.insert(merchantCache)
          .values({ merchant: item.merchant, ...values })
          .onConflictDoUpdate({ target: merchantCache.merchant, set: values })
          .run();
      }
    });
    if (response.capped) {
      capped = true;
      break;
    }
  }
  categorised += await recategoriseHistory({ uncategorisedOnly: true });
  return { asked: items.size, categorised, capped };
}
