import { amountBand, localTime, lookupBuiltin, normaliseMerchant, shareableVpa, timeOfDay, type AiCategoriseItem } from '@money-plant/categoriser';
import { paise } from '@money-plant/core';
import { looksLikePerson } from '@money-plant/matcher';
import type { CategoriseCategory } from '../jobs/categorise';

/** The columns the eval reads from the user's own synced rows. */
export interface EvalAccount {
  id: string;
  type: string;
  name: string;
  parent_id: string | null;
  category_key: string | null;
  deleted_at: string | null;
}

export interface EvalTransaction {
  occurred_at: string;
  counterparty: string | null;
  kind: string;
  postings: { account_id: string; amount_paise: number; deleted_at?: string | null }[];
  sources: { kind: string; parsed_fields: Record<string, unknown> | null }[];
}

/** One merchant the user tagged by hand, with the category they chose most often. */
export interface LabelledMerchant {
  item: AiCategoriseItem;
  expected: string;
  entries: number;
  /** The built-in dictionary already knows it, so in the app it never reaches the AI. */
  inDictionary: boolean;
}

export interface Dataset {
  categories: CategoriseCategory[];
  merchants: LabelledMerchant[];
  /** Entries left out, by reason, so an empty set can be explained. */
  skipped?: Record<string, number>;
}

type Channel = Parameters<typeof looksLikePerson>[0]['channel'];

const IST = 330;

/**
 * The categories the app sends with a job: the user's own, by standard key,
 * as ai-categorise.ts does. A sub-category the user made (key "food.custom")
 * can't be named by the AI, so it is scored against its parent.
 */
export function categoryList(accounts: readonly EvalAccount[]): CategoriseCategory[] {
  return accounts
    .filter((a) => a.type === 'category' && !a.deleted_at && a.category_key && !a.category_key.endsWith('custom'))
    .map((a) => ({ key: a.category_key!, name: a.name }));
}

function expectedKey(account: EvalAccount, byId: ReadonlyMap<string, EvalAccount>): string | null {
  const key = account.category_key;
  if (!key) return null;
  if (!key.endsWith('custom')) return key;
  const parent = account.parent_id ? byId.get(account.parent_id) : undefined;
  return parent?.category_key && !parent.category_key.endsWith('custom') ? parent.category_key : null;
}

/**
 * Turns the user's hand-categorised entries into the eval set: one row per
 * merchant with the fields a real job would carry. Payments to people are
 * left out, as they never go to the AI (CAT-4).
 */
export function buildDataset(accounts: readonly EvalAccount[], transactions: readonly EvalTransaction[]): Dataset {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const votes = new Map<string, { item: AiCategoriseItem; keys: Map<string, number>; entries: number; label: string; vpa: string | null }>();
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  for (const tx of transactions) {
    const postings = tx.postings.filter((p) => !p.deleted_at);
    if (tx.kind !== 'expense' && tx.kind !== 'income') {
      skip('not a spend or income (transfer, IOU and so on)');
      continue;
    }
    if (!tx.counterparty) {
      skip('no payee name');
      continue;
    }
    if (postings.length !== 2) {
      skip('split across several categories');
      continue;
    }
    const category = postings.map((p) => byId.get(p.account_id)).find((a) => a?.type === 'category');
    const own = postings.find((p) => {
      const type = byId.get(p.account_id)?.type;
      return type && type !== 'category' && type !== 'person';
    });
    if (!category || !own) {
      skip('no category or own account');
      continue;
    }
    const expected = expectedKey(category, byId);
    if (!expected) {
      skip('in a category you made at the top level (the AI only knows standard ones)');
      continue;
    }
    const sms = tx.sources.find((s) => s.kind === 'sms')?.parsed_fields ?? {};
    const vpa = typeof sms.vpa === 'string' ? sms.vpa : null;
    const channel = (typeof sms.channel === 'string' ? sms.channel : 'upi') as Channel;
    if (looksLikePerson({ channel, counterparty: tx.counterparty, vpa })) {
      skip('payment to a person (never sent to the AI)');
      continue;
    }
    const merchant = normaliseMerchant(tx.counterparty);
    if (merchant.length < 2 || /\d{6,}/.test(merchant)) {
      skip('payee is mostly a number');
      continue;
    }
    let entry = votes.get(merchant);
    if (!entry) {
      entry = {
        item: {
          merchant,
          label: tx.counterparty.replace(/\d{4,}/g, ' ').replace(/\s+/g, ' ').trim(),
          vpa: shareableVpa(vpa),
          amountBand: amountBand(paise(Math.abs(own.amount_paise))),
          timeOfDay: timeOfDay(localTime(tx.occurred_at, IST).minuteOfDay),
          direction: own.amount_paise < 0 ? 'debit' : 'credit',
        },
        keys: new Map(),
        entries: 0,
        label: tx.counterparty,
        vpa,
      };
      votes.set(merchant, entry);
    }
    entry.entries++;
    entry.keys.set(expected, (entry.keys.get(expected) ?? 0) + 1);
  }
  const merchants = [...votes.values()].map((v) => ({
    item: v.item,
    expected: [...v.keys.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    entries: v.entries,
    inDictionary: lookupBuiltin(v.label, v.vpa) !== null,
  }));
  merchants.sort((a, b) => b.entries - a.entries || a.item.merchant.localeCompare(b.item.merchant));
  return { categories: categoryList(accounts), merchants, skipped };
}
