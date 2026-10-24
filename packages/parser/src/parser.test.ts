import { describe, expect, it } from 'vitest';
import { identifyBankSender, normaliseSender } from './senders';
import { parseBankText } from './sms';
import { cleanCounterparty } from './extract';
import { parseNotification } from './notification';
import { extractDate, parsePreDebitText } from './predebit';

describe('senders', () => {
  it.each([
    ['VM-HDFCBK', 'HDFCBK'],
    ['JD-HDFCBK-S', 'HDFCBK'],
    ['ax-icicit-t', 'ICICIT'],
    ['SBIUPI', 'SBIUPI'],
  ])('normalises %s', (address, header) => {
    expect(normaliseSender(address)).toBe(header);
  });

  it.each([
    ['VM-HDFCBK', 'hdfc'],
    ['AX-ICICIT-S', 'icici'],
    ['BZ-SBIUPI', 'sbi'],
    ['VM-ATMSBI', 'sbi'],
    ['AD-SBICRD', 'sbi'],
    ['VM-HSBCIN', 'hsbc'],
    ['VM-HDFCMF', null],
    ['VM-SBIMF', null],
    ['VM-SBILIF', null],
    ['VM-ICICIP', null],
    ['+919876543210', null],
    ['VM-AMAZON', null],
  ])('identifies %s', (address, bank) => {
    expect(identifyBankSender(address)).toBe(bank);
  });
});

describe('mandate notices', () => {
  it.each([
    'Your AutoPay mandate with ASPRESENTED is successfully created towards Google Play from 13-May-26 to 31-Dec-36 for Rs 1300.00, RRN 629412345678-ICICI Bank.',
    'Your e-mandate for Rs 5,000.00 towards ACME SIP has been registered on A/c XX1234.',
    'AutoPay for NETFLIX of Rs 649 is cancelled as requested.',
  ])('ignores a mandate that is set up or changed: %s', (body) => {
    expect(parseBankText('icici', body)).toEqual({ status: 'ignored', reason: 'reminder' });
  });

  it('still reads a debit made under a mandate', () => {
    const result = parseBankText('icici', 'Rs 149.00 debited from ICICI Bank Acct XX234 on 17-Oct-26 for AutoPay mandate towards NETFLIX. RRN 629412345678.');
    expect(result.status).toBe('parsed');
  });
});

describe('counterparty', () => {
  it.each(['ICICI Bank Savings Account XX798', 'Savings Account XX1234', 'HDFC Bank Card x5678', 'your Acct XX234'])('rejects the user\'s own account: %s', (raw) => {
    expect(cleanCounterparty(raw)).toBeNull();
  });

  it('keeps merchant names', () => {
    expect(cleanCounterparty('ROYAL CAFE')).toBe('ROYAL CAFE');
  });
});

describe('generic parser', () => {
  it('reads a debit with an unfamiliar layout', () => {
    const result = parseBankText('hdfc', 'Alert: Rs 1,050.50 debited from a/c XX1234 to VPA zomato@hdfcbank. Ref 629400001111. Avl bal Rs 9,000');
    expect(result).toMatchObject({
      status: 'parsed',
      transaction: {
        template: 'generic',
        direction: 'debit',
        amount: 105050,
        accountLast: '1234',
        vpa: 'zomato@hdfcbank',
        reference: '629400001111',
        balance: 900000,
        confidence: 0.75,
      },
    });
  });

  it('lowers confidence when it cannot find the account', () => {
    const result = parseBankText('sbi', 'Rs 300 credited for refund from FLIPKART.');
    expect(result).toMatchObject({ status: 'parsed', transaction: { direction: 'credit', accountLast: null, confidence: 0.5 } });
  });

  it('never returns a fractional amount', () => {
    const result = parseBankText('icici', 'Acct XX234 debited for Rs 0.29 on 21-Oct-26; TEST credited. UPI:629400001111.');
    expect(result.status).toBe('parsed');
    if (result.status === 'parsed') expect(Number.isInteger(result.transaction.amount)).toBe(true);
  });

  it('does not take the balance as the amount', () => {
    const result = parseBankText('hdfc', 'Avl bal Rs 9,000.00 after Rs 450.00 debited from A/c XX1234');
    expect(result).toMatchObject({ status: 'parsed', transaction: { amount: 45000, balance: 900000 } });
  });
});

describe('parseNotification', () => {
  it.each([
    ['com.google.android.apps.nbu.paisa.user', 'Paid ₹450 to Swiggy', '', 'debit', 45000, 'Swiggy'],
    ['com.phonepe.app', 'Received ₹2,000 from Ravi Kumar', 'Credited to HDFC Bank', 'credit', 200000, 'Ravi Kumar'],
    ['com.phonepe.app', '₹120 sent to Chai Point', 'Payment successful', 'debit', 12000, 'Chai Point'],
    ['indwin.c3.shareapp', 'Ravi Kumar paid you ₹500', '', 'credit', 50000, 'Ravi Kumar'],
  ])('reads %s: %s', (packageName, title, text, direction, amount, counterparty) => {
    expect(parseNotification({ packageName, title, text })).toEqual({
      app: expect.any(String),
      direction,
      amount,
      counterparty,
    });
  });

  it('ignores other apps and non-payment notifications', () => {
    expect(parseNotification({ packageName: 'com.whatsapp', title: 'Paid ₹450 to Swiggy', text: '' })).toBeNull();
    expect(parseNotification({ packageName: 'com.phonepe.app', title: 'Get ₹50 cashback offer', text: 'Pay bills now' })).toBeNull();
    expect(parseNotification({ packageName: 'com.phonepe.app', title: 'Ravi Kumar has requested ₹300', text: '' })).toBeNull();
  });
});

describe('parsePreDebit', () => {
  const now = new Date(2026, 9, 23, 10, 0);

  it('reads dates in the formats banks use', () => {
    expect(extractDate('on 25-Oct-26 towards', now)).toBe('2026-10-25');
    expect(extractDate('on 05/11/26.', now)).toBe('2026-11-05');
    expect(extractDate('due 2026-11-01', now)).toBe('2026-11-01');
    expect(extractDate('on 31-02-2026', now)).toBeNull();
  });

  it('ignores bill reminders, statements and old notices', () => {
    expect(parsePreDebitText('hdfc', 'Your HDFC Bank Credit Card ending 5678 statement is ready. Total due Rs.12,400.00. Pay by 05-11-2026.', now)).toBeNull();
    expect(parsePreDebitText('hdfc', 'Rs.649.00 will be debited from your card 5678 on 01-09-2026 towards NETFLIX.', now)).toBeNull();
    expect(parsePreDebitText('hdfc', 'Rs.649.00 debited from your card 5678 on 22-10-2026 towards NETFLIX.', now)).toBeNull();
  });

  it('leaves the payee empty when the notice names none', () => {
    expect(parsePreDebitText('sbi', 'Rs 1,000 will be debited from A/c XX1234 on 28-10-2026 as per your mandate.', now)).toMatchObject({
      amount: 100000,
      payee: null,
      dueDate: '2026-10-28',
      accountLast: '1234',
    });
  });
});
