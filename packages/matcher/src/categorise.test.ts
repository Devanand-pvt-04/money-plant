import { describe, expect, it } from 'vitest';
import { paise } from '@money-plant/core';
import {
  STANDARD_CATEGORIES,
  categorise,
  localTime,
  parentKey,
  type Rule,
  type UserCategory,
} from '@money-plant/categoriser';
import { normaliseSender, parseNotification, parseSms } from '@money-plant/parser';
import { MemoryStore } from './memory-store';
import { ingestNotification, ingestSms, type PipelineContext } from './pipeline';

const categories: UserCategory[] = STANDARD_CATEGORIES.map((c) => ({
  id: `cat:${c.key}`,
  name: c.name,
  key: c.key,
  parentId: parentKey(c.key) ? `cat:${parentKey(c.key)}` : null,
}));

function setup(rules: Rule[] = []) {
  const store = new MemoryStore();
  let n = 0;
  const ctx: PipelineContext = {
    store,
    newId: () => `id-${n++}`,
    categorise: async (request) => categorise({ ...request, ...localTime(request.occurredAt, 330) }, { rules, categories }),
  };
  let fp = 0;
  const sms = async (body: string, receivedAt: string) => {
    const result = parseSms({ sender: 'VM-HDFCBK', body });
    if (result.status !== 'parsed') throw new Error(`not parsed: ${result.status}`);
    return ingestSms(ctx, { parsed: result.transaction, sender: normaliseSender('VM-HDFCBK'), receivedAt, fingerprint: `f${fp++}`, rawText: body });
  };
  const notify = async (packageName: string, title: string, receivedAt: string) => {
    const parsed = parseNotification({ packageName, title, text: '' });
    if (!parsed) throw new Error('not parsed');
    return ingestNotification(ctx, { parsed, receivedAt, fingerprint: `n${fp++}` });
  };
  const only = () => {
    const [tx] = store.live();
    if (!tx) throw new Error('no entry');
    return tx;
  };
  return { store, sms, notify, only };
}

const SENT = (amount: string, to: string, ref: string) =>
  `Sent Rs.${amount}\nFrom HDFC Bank A/C *1234\nTo ${to}\nOn 21/10/26\nRef ${ref}\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808`;

const busPattern: Rule = {
  id: 'bus',
  status: 'active',
  autoConfirm: false,
  hits: 0,
  misses: 0,
  categoryId: 'cat:transport.bus',
  match: {
    kind: 'pattern',
    direction: 'debit',
    minAmount: paise(1500),
    maxAmount: paise(2500),
    startMinute: 8 * 60,
    endMinute: 10 * 60,
    weekdays: [1, 2, 3, 4, 5],
    accountId: null,
    payeeKind: 'person',
  },
};

describe('categorising captured entries (CAT-2)', () => {
  it('posts a known merchant to its category and says why (CAT-6)', async () => {
    const { sms, only } = setup();
    await sms(SENT('450.00', 'SWIGGY', '629412345678'), '2026-10-21T10:00:00.000Z');
    const tx = only();
    expect(tx.postings[1]!.accountId).toBe('cat:food.delivery');
    expect(tx).toMatchObject({ categoryReason: 'dictionary', status: 'confirmed', reviewReason: null });
  });

  it('suggests a learned pattern for a person instead of asking about the person (CAT-4, CAT-8)', async () => {
    const { sms, only } = setup([busPattern]);
    // 08:40 IST on a Wednesday.
    await sms(SENT('20.00', 'MURUGAN S', '629412340001'), '2026-10-21T03:10:00.000Z');
    expect(only()).toMatchObject({ categoryReason: 'pattern', categoryRuleId: 'bus', reviewReason: 'pattern', status: 'pending' });
    expect(only().postings[1]!.accountId).toBe('cat:transport.bus');
  });

  it('still asks about a person no pattern matches', async () => {
    const { sms, only } = setup([busPattern]);
    await sms(SENT('2000.00', 'MURUGAN S', '629412340001'), '2026-10-21T03:10:00.000Z');
    expect(only()).toMatchObject({ categoryReason: null, reviewReason: 'person' });
  });

  it('categorises once a UPI app notification names the merchant (CAP-3)', async () => {
    const { store, sms, notify, only } = setup();
    await sms('Update! INR 450.00 debited from HDFC Bank XX1234 on 21-OCT-26. Info: UPI-629412345678. Avl bal:INR 9,000.00', '2026-10-21T10:00:00.000Z');
    expect(only().categoryReason).toBeNull();
    await notify('com.google.android.apps.nbu.paisa.user', 'Paid ₹450 to Zomato', '2026-10-21T10:00:05.000Z');
    expect(only()).toMatchObject({ counterparty: 'Zomato', categoryReason: 'dictionary' });
    expect(store.live()).toHaveLength(1);
  });
});

describe('fields the user set (LED-8)', () => {
  it('keeps a payee name the user typed when another source arrives', async () => {
    const { store, sms, notify, only } = setup();
    await sms('Update! INR 450.00 debited from HDFC Bank XX1234 on 21-OCT-26. Info: UPI-629412345678. Avl bal:INR 9,000.00', '2026-10-21T10:00:00.000Z');
    const tx = only();
    await store.saveTransaction({ ...tx, counterparty: 'Office canteen', userSetFields: ['counterparty'] });
    await notify('com.phonepe.app', 'Paid ₹450 to Swiggy', '2026-10-21T10:00:05.000Z');
    expect(only().counterparty).toBe('Office canteen');
    expect(only().sources).toHaveLength(2);
  });

  it('does not turn an entry the user categorised into a transfer', async () => {
    const { store, sms } = setup();
    await sms(SENT('10000.00', 'DEVA S', '629412345600'), '2026-10-21T10:00:00.000Z');
    const [tx] = store.live();
    await store.saveTransaction({ ...tx!, postings: [tx!.postings[0]!, { ...tx!.postings[1]!, accountId: 'cat:housing.rent' }], categoryReason: 'user', userSetFields: ['category'] });
    const credit = parseSms({ sender: 'AX-ICICIB', body: 'Dear Customer, Acct XX234 is credited with Rs 10,000.00 on 21-Oct-26 from DEVA S. UPI:629412345600-ICICI Bank.' });
    if (credit.status !== 'parsed') throw new Error();
    const result = await ingestSms(
      { store, newId: () => 'x' + Math.random() },
      { parsed: credit.transaction, sender: 'ICICIB', receivedAt: '2026-10-21T10:01:00.000Z', fingerprint: 'credit', rawText: null },
    );
    expect(result.outcome).toBe('created');
    expect(store.live()).toHaveLength(2);
  });
});
