import { describe, expect, it } from 'vitest';
import { paise } from '@money-plant/core';
import { normaliseSender, parseNotification, parseSms } from '@money-plant/parser';
import { MemoryStore } from './memory-store';
import { checkTransaction, ingestNotification, ingestSms, type PipelineContext } from './pipeline';

function setup() {
  const store = new MemoryStore();
  let n = 0;
  const ctx: PipelineContext = { store, newId: () => `id-${n++}` };
  let fp = 0;
  const sms = async (sender: string, body: string, receivedAt: string) => {
    const result = parseSms({ sender, body });
    if (result.status !== 'parsed') throw new Error(`not parsed: ${result.status}`);
    return ingestSms(ctx, {
      parsed: result.transaction,
      sender: normaliseSender(sender),
      receivedAt,
      fingerprint: `${sender}|${receivedAt}|${body.length}|${fp++}`,
      rawText: body,
    });
  };
  const notify = async (packageName: string, title: string, receivedAt: string) => {
    const parsed = parseNotification({ packageName, title, text: '' });
    if (!parsed) throw new Error('not parsed');
    return ingestNotification(ctx, { parsed, receivedAt, fingerprint: `${packageName}|${receivedAt}|${title}` });
  };
  const accountNamed = (name: string) => [...store.accounts.values()].find((a) => a.name === name)!;
  return { store, ctx, sms, notify, accountNamed };
}

const HDFC_SENT = (amount: string, to: string, ref: string) =>
  `Sent Rs.${amount}\nFrom HDFC Bank A/C *1234\nTo ${to}\nOn 21/10/26\nRef ${ref}\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808`;

describe('ingestSms', () => {
  it('creates an account and a balanced entry from the first SMS', async () => {
    const { store, sms, accountNamed } = setup();
    const result = await sms('VM-HDFCBK', HDFC_SENT('450.00', 'SWIGGY', '629412345678'), '2026-10-21T10:00:00.000Z');
    expect(result.outcome).toBe('created');
    const account = accountNamed('HDFC Bank ••1234');
    expect(account).toMatchObject({ type: 'bank', institution: 'HDFC Bank', last4: '1234' });
    const [tx] = store.live();
    expect(checkTransaction(tx!)).toBeNull();
    expect(tx).toMatchObject({ kind: 'expense', status: 'confirmed', counterparty: 'SWIGGY' });
    expect(store.balance(account.id)).toBe(-45000);
  });

  it('ignores the same message read twice', async () => {
    const { store, ctx } = setup();
    const parsed = parseSms({ sender: 'VM-HDFCBK', body: HDFC_SENT('450.00', 'SWIGGY', '629412345678') });
    if (parsed.status !== 'parsed') throw new Error();
    const capture = { parsed: parsed.transaction, sender: 'HDFCBK', receivedAt: '2026-10-21T10:00:00.000Z', fingerprint: 'same', rawText: null };
    await ingestSms(ctx, capture);
    expect((await ingestSms(ctx, capture)).outcome).toBe('duplicate_source');
    expect(store.live()).toHaveLength(1);
  });

  it('keeps two real payments of the same amount from the same bank apart', async () => {
    const { store, sms } = setup();
    await sms('VM-HDFCBK', HDFC_SENT('20.00', 'CHAI POINT', '629400000001'), '2026-10-21T10:00:00.000Z');
    await sms('VM-HDFCBK', HDFC_SENT('20.00', 'CHAI POINT', '629400000002'), '2026-10-21T10:03:00.000Z');
    expect(store.live()).toHaveLength(2);
  });

  it('merges the same payment reported with the same reference (LED-3)', async () => {
    const { store, sms } = setup();
    await sms('VM-HDFCBK', HDFC_SENT('450.00', 'SWIGGY', '629412345678'), '2026-10-21T10:00:00.000Z');
    const second = await sms(
      'VM-HDFCBN',
      'Alert: Rs 450.00 debited from a/c XX1234 to VPA swiggy@axisbank. UPI Ref 629412345678.',
      '2026-10-21T10:00:30.000Z',
    );
    expect(second.outcome).toBe('attached');
    expect(store.live()).toHaveLength(1);
    expect(store.live()[0]!.sources).toHaveLength(2);
  });

  it('merges a transfer between two of the user\'s accounts (LED-4)', async () => {
    const { store, sms, accountNamed } = setup();
    await sms('VM-HDFCBK', HDFC_SENT('10000.00', 'DEVA S', '629412345600'), '2026-10-21T10:00:00.000Z');
    const credit = await sms(
      'AX-ICICIB',
      'Dear Customer, Acct XX234 is credited with Rs 10,000.00 on 21-Oct-26 from DEVA S. UPI:629412345600-ICICI Bank.',
      '2026-10-21T10:00:20.000Z',
    );
    expect(credit.outcome).toBe('transfer');
    const [tx] = store.live();
    expect(store.live()).toHaveLength(1);
    expect(tx).toMatchObject({ kind: 'transfer', status: 'confirmed', reviewReason: null });
    expect(checkTransaction(tx!)).toBeNull();
    expect(store.balance(accountNamed('HDFC Bank ••1234').id)).toBe(-1000000);
    expect(store.balance(accountNamed('ICICI Bank ••234').id)).toBe(1000000);
    expect(store.balance(accountNamed('Uncategorised spending').id)).toBe(0);
  });

  it('pairs a card bill payment within 3 days, but asks the user to confirm', async () => {
    const { store, sms } = setup();
    await sms('VM-HDFCBK', 'Update! INR 25,000.00 debited from HDFC Bank XX1234 on 12-OCT-26. Info: BILLPAY HDFC CARD. Avl bal:INR 40,000.00', '2026-10-12T09:00:00.000Z');
    const result = await sms('VM-HDFCBK', 'Payment of Rs 25,000.00 has been received on your HDFC Bank Credit Card ending 5678 on 14-10-2026. Thank you.', '2026-10-14T09:00:00.000Z');
    expect(result.outcome).toBe('transfer');
    expect(store.live()).toHaveLength(1);
    expect(store.live()[0]).toMatchObject({ kind: 'transfer', status: 'pending', reviewReason: 'possible_transfer' });
  });

  it('does not pair a transfer further apart than 24 hours', async () => {
    const { store, sms } = setup();
    await sms('VM-HDFCBK', HDFC_SENT('2000.00', 'RAVI KUMAR', '629412345601'), '2026-10-01T10:00:00.000Z');
    await sms('AX-ICICIB', 'Dear Customer, Acct XX234 is credited with Rs 2,000.00 on 03-Oct-26 from PRIYA S. UPI:629412345602-ICICI Bank.', '2026-10-03T10:00:00.000Z');
    expect(store.live()).toHaveLength(2);
  });

  it('sends payments to people to review', async () => {
    const { store, sms } = setup();
    await sms('VM-HDFCBK', HDFC_SENT('2000.00', 'RAVI KUMAR', '629412345601'), '2026-10-01T10:00:00.000Z');
    expect(store.live()[0]).toMatchObject({ status: 'pending', reviewReason: 'person' });
  });

  it('derives the opening balance from the earliest balance in an SMS', async () => {
    const { store, sms, accountNamed } = setup();
    await sms('VM-HDFCBK', HDFC_SENT('450.00', 'SWIGGY', '629412345678'), '2026-10-01T10:00:00.000Z');
    await sms('VM-HDFCBK', 'Update! INR 5,000.00 debited from HDFC Bank XX1234 on 02-OCT-26. Info: NEFT-ACME RENTALS. Avl bal:INR 12,000.00', '2026-10-02T10:00:00.000Z');
    const id = accountNamed('HDFC Bank ••1234').id;
    expect(store.balance(id)).toBe(1200000);
    // A later balance that agrees keeps it there.
    await sms('VM-HDFCBK', 'Update! INR 1,000.00 debited from HDFC Bank XX1234 on 03-OCT-26. Info: ATM WDL. Avl bal:INR 11,000.00', '2026-10-03T10:00:00.000Z');
    expect(store.balance(id)).toBe(1100000);
    // An older message read later doesn't move the bank-reported balance.
    await sms('VM-HDFCBK', HDFC_SENT('100.00', 'METRO', '629412340001'), '2026-09-30T10:00:00.000Z');
    expect(store.balance(id)).toBe(1100000);
    expect(store.anchors).toHaveLength(2);
  });

  it('keeps a user-entered balance when older history is imported', async () => {
    const { store, sms } = setup();
    store.accounts.set('mine', { id: 'mine', type: 'bank', name: 'HDFC savings', institution: 'HDFC', last4: '1234' });
    store.openings.set('mine', paise(5000000));
    store.refs.set('mine', { kind: 'user', balance: paise(5000000), at: '2026-10-20T00:00:00.000Z' });
    await sms('VM-HDFCBK', HDFC_SENT('450.00', 'SWIGGY', '629412345678'), '2026-10-10T10:00:00.000Z');
    expect(store.balance('mine')).toBe(5000000);
    await sms('VM-HDFCBK', HDFC_SENT('300.00', 'ZOMATO', '629412345679'), '2026-10-21T10:00:00.000Z');
    expect(store.balance('mine')).toBe(4970000);
  });

  it('matches ICICI\'s 3 digits to a 4-digit account and learns the full number', async () => {
    const { store, sms } = setup();
    store.accounts.set('icici', { id: 'icici', type: 'bank', name: 'ICICI', institution: 'ICICI Bank', last4: '234' });
    await sms('VM-ICICIB', 'Your ICICI Bank Acct XX1234 has been debited with INR 799.00 on 10-Oct-26 towards NETFLIX. Avl Bal INR 41,546.67.', '2026-10-10T10:00:00.000Z');
    expect(store.accounts.get('icici')!.last4).toBe('1234');
    expect(store.accounts.size).toBe(2); // plus Uncategorised spending
  });
});

describe('ingestNotification', () => {
  it('adds the payee name to the matching SMS entry (CAP-3)', async () => {
    const { store, sms, notify } = setup();
    await sms('VM-HDFCBK', 'Update! INR 450.00 debited from HDFC Bank XX1234 on 21-OCT-26. Info: UPI-629412345678. Avl bal:INR 9,000.00', '2026-10-21T10:00:00.000Z');
    const result = await notify('com.google.android.apps.nbu.paisa.user', 'Paid ₹450 to Swiggy', '2026-10-21T10:00:05.000Z');
    expect(result.outcome).toBe('attached');
    expect(store.live()[0]).toMatchObject({ counterparty: 'Swiggy' });
    expect(store.live()[0]!.sources.map((s) => s.kind)).toEqual(['sms', 'notification']);
  });

  it('holds a notification that arrives before its SMS, then attaches it', async () => {
    const { store, sms, notify } = setup();
    expect((await notify('com.phonepe.app', 'Paid ₹450 to Swiggy', '2026-10-21T09:59:55.000Z')).outcome).toBe('held');
    expect(store.live()).toHaveLength(0);
    await sms('VM-HDFCBK', 'Update! INR 450.00 debited from HDFC Bank XX1234 on 21-OCT-26. Info: UPI-629412345678. Avl bal:INR 9,000.00', '2026-10-21T10:00:00.000Z');
    expect(store.live()[0]).toMatchObject({ counterparty: 'Swiggy' });
    expect(store.pending.size).toBe(0);
  });
});
