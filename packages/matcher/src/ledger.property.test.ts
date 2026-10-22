import { describe, expect, it } from 'vitest';
import { validatePostings } from '@money-plant/core';
import { parseSms } from '@money-plant/parser';
import { MemoryStore } from './memory-store';
import { ingestSms } from './pipeline';

/** Small seeded PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const TEMPLATES = [
  (amt: string, ref: string) => ({ sender: 'VM-HDFCBK', body: `Sent Rs.${amt}\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 21/10/26\nRef ${ref}\nNot You?` }),
  (amt: string, ref: string) => ({ sender: 'AX-ICICIB', body: `Dear Customer, Acct XX234 is credited with Rs ${amt} on 21-Oct-26 from DEVA S. UPI:${ref}-ICICI Bank.` }),
  (amt: string, ref: string) => ({ sender: 'BZ-SBIUPI', body: `Dear UPI user A/C X1234 debited by ${amt} on date 21Oct26 trf to ZOMATO Refno ${ref}. -SBI` }),
  (amt: string) => ({ sender: 'AD-SBICRD', body: `Rs.${amt} spent on your SBI Credit Card ending 5678 at AMAZON on 21/10/26.` }),
  (amt: string) => ({ sender: 'VM-HDFCBK', body: `Update! INR ${amt} debited from HDFC Bank XX1234 on 18-OCT-26. Info: ATM WDL. Avl bal:INR 50,000.00` }),
];

describe('ledger properties', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: postings balance, every entry has a source, replays are no-ops', async (seed) => {
    const random = rng(seed);
    const store = new MemoryStore();
    let n = 0;
    const ctx = { store, newId: () => `id-${n++}` };
    const captures = Array.from({ length: 60 }, (_, i) => {
      const amount = `${1 + Math.floor(random() * 5000)}.${String(Math.floor(random() * 100)).padStart(2, '0')}`;
      // Reuse references sometimes so duplicates and transfers happen.
      const ref = `6294${String(Math.floor(random() * 15)).padStart(8, '0')}`;
      const message = TEMPLATES[Math.floor(random() * TEMPLATES.length)]!(amount, ref);
      const receivedAt = new Date(Date.UTC(2026, 9, 1) + Math.floor(random() * 10 * 24 * 3600_000)).toISOString();
      return { ...message, receivedAt, fingerprint: `fp-${i}` };
    });

    const run = async (list: typeof captures) => {
      for (const c of list) {
        const parsed = parseSms(c);
        if (parsed.status !== 'parsed') continue;
        await ingestSms(ctx, { parsed: parsed.transaction, sender: c.sender, receivedAt: c.receivedAt, fingerprint: c.fingerprint, rawText: null });
      }
    };
    await run(captures);
    const count = store.live().length;
    const balances = [...store.accounts.keys()].map((id) => store.balance(id));

    for (const tx of store.live()) {
      expect(validatePostings(tx.postings)).toBeNull();
      expect(tx.sources.length).toBeGreaterThan(0);
      for (const p of tx.postings) expect(Number.isSafeInteger(p.amount)).toBe(true);
    }
    // Sum of every account's postings is zero across the whole ledger (double entry).
    let total = 0;
    for (const tx of store.live()) for (const p of tx.postings) total += p.amount;
    expect(total).toBe(0);

    // Reading the inbox again, in any order, changes nothing.
    await run([...captures].reverse());
    expect(store.live().length).toBe(count);
    expect([...store.accounts.keys()].map((id) => store.balance(id))).toEqual(balances);
  });
});
