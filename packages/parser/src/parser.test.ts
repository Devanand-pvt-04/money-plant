import { describe, expect, it } from 'vitest';
import { identifyBankSender, isBusinessSender, looksLikeMoney, normaliseSender } from './senders';
import { parseAnySms, parseBankText } from './sms';
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
    ['AX-PNBSMS-S', 'pnb'],
    ['VM-PUNBNK', 'pnb'],
    ['VM-PNBHFL', null],
    ['VM-PNBMET', null],
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

describe('general reader', () => {
  it('stops a payee at "thru" (PNB wording, any sender)', () => {
    const result = parseAnySms({ sender: 'VM-NEWBNK', body: 'A/c X1234 debited INR 5.00 on 06-11-26 to RAVI KUMAR thru UPI:629412345678.Bal INR 100.00' });
    expect(result).toMatchObject({ status: 'parsed', transaction: { bank: null, counterparty: 'RAVI KUMAR', reference: '629412345678' } });
  });
});

describe('card bill payments (decision 0023)', () => {
  it.each([
    ['icici', 'ICICI Bank Acct XX798 debited for Rs 3131.96 on 13-Nov-26; CC BillPay-5678 credited. Call 18002662 for dispute.', '5678'],
    ['hdfc', 'Update! INR 25,000.00 debited from HDFC Bank XX1234 on 12-OCT-26. Info: BILLPAY HDFC CARD. Avl bal:INR 40,000.00', null],
    ['sbi', 'Your A/c XX4321 is debited by Rs.12,400.00 towards Credit Card XX5678 payment on 14/10/26. Avl Bal Rs.8,000.00', '5678'],
  ] as const)('reads a bank debit that pays a card (%s)', (bank, body, last4) => {
    const result = parseBankText(bank, body);
    expect(result.status === 'parsed' && result.transaction).toMatchObject({ direction: 'debit', instrument: 'account', cardBill: { last4 } });
  });

  it('works for any bank', () => {
    const result = parseAnySms({ sender: 'VM-NEWBNK', body: 'A/c X1234 debited INR 2,000.00 on 06-11-26 for credit card bill payment card ending 9876. Bal INR 100.00' });
    expect(result.status === 'parsed' && result.transaction).toMatchObject({ direction: 'debit', accountLast: '1234', cardBill: { last4: '9876' } });
  });

  it.each([
    'Payment of INR 18,500.00 towards ICICI Bank Credit Card XX5678 has been received on 12-Oct-26. Thank you.',
    'INR 1,299.00 spent on ICICI Bank Credit Card XX5678 on 21-Oct-26 at AMAZON. Avl Limit: INR 98,701.00.',
    'Rs 149.00 debited from ICICI Bank Acct XX234 on 17-Oct-26 for AutoPay mandate towards NETFLIX. RRN 629412345678.',
  ])('leaves other messages alone: %s', (body) => {
    const result = parseBankText('icici', body);
    expect(result.status === 'parsed' && result.transaction.cardBill).toBeUndefined();
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

describe('foreign-currency spends (CAP-10)', () => {
  it('reads a card spend in dollars, with the limit still in rupees', () => {
    const result = parseBankText('hdfc', 'USD 25.00 spent on HDFC Bank Card XX4321 at AMAZON WEB SERVICES on 08-11-26. Avl Lmt: INR 1,20,000.00');
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') return;
    expect(result.transaction).toMatchObject({ amount: 2500, currency: 'USD', direction: 'debit', accountLast: '4321', availableLimit: 12_000_000 });
  });

  it('reads symbols and three-decimal currencies', () => {
    const euro = parseBankText('icici', 'Your ICICI Bank Credit Card XX1111 was used for a transaction of €12.40 at SNCF on 01-Nov-26.');
    expect(euro.status === 'parsed' && euro.transaction).toMatchObject({ amount: 1240, currency: 'EUR' });
    const dinar = parseBankText('sbi', 'Txn of KWD 3.250 done on SBI Credit Card ending 2222 at ALSHAYA.');
    expect(dinar.status === 'parsed' && dinar.transaction).toMatchObject({ amount: 3250, currency: 'KWD' });
  });

  it('keeps the rupee amount when the message gives both', () => {
    const result = parseBankText('hdfc', 'Rs.2,105.50 spent on HDFC Bank Card XX4321 at AMAZON (USD 25.00) on 08-11-26.');
    expect(result.status === 'parsed' && result.transaction).toMatchObject({ amount: 210_550 });
    expect(result.status === 'parsed' && result.transaction.currency).toBeUndefined();
  });

  it('ignores words that look like codes but are not currencies', () => {
    const result = parseBankText('sbi', 'Your A/c XX1234 is debited by Rs 450 for UPI 512345678901.');
    expect(result.status === 'parsed' && result.transaction).toMatchObject({ amount: 45_000 });
    expect(result.status === 'parsed' && result.transaction.currency).toBeUndefined();
  });
});

describe('any business sender (CAP-11)', () => {
  it('tells businesses from people', () => {
    expect(isBusinessSender('AD-ENBD')).toBe(true);
    expect(isBusinessSender('Revolut')).toBe(true);
    expect(isBusinessSender('57575')).toBe(true);
    expect(isBusinessSender('+971501234567')).toBe(false);
    expect(isBusinessSender('9876543210')).toBe(false);
    expect(isBusinessSender('')).toBe(false);
  });

  it('only lets money messages through', () => {
    expect(looksLikeMoney('Your card ending 1234 was charged AED 85.00 at CARREFOUR.')).toBe(true);
    expect(looksLikeMoney('Paid 12,50 EUR to Lidl')).toBe(true);
    expect(looksLikeMoney('Your parcel will arrive tomorrow between 9 and 12')).toBe(false);
    expect(looksLikeMoney('Payment reminder for your order 4411')).toBe(false);
  });

  it('reads a bank abroad through the general reader', () => {
    const result = parseAnySms({ sender: 'AD-ENBD', body: 'Purchase of AED 85.00 on your Credit Card ending 1234 at CARREFOUR was successful.' });
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') return;
    expect(result.transaction).toMatchObject({ bank: null, direction: 'debit', amount: 8500, currency: 'AED', accountLast: '1234', template: 'generic' });
  });

  it('reads European number styles with the code after the amount', () => {
    const result = parseAnySms({ sender: 'N26', body: 'You paid 1.234,56 EUR to MEDIA MARKT with your card.' });
    expect(result.status === 'parsed' && result.transaction).toMatchObject({ amount: 123_456, currency: 'EUR', direction: 'debit' });
  });

  it('keeps tuned rules for known banks and never reads phone numbers', () => {
    const hdfc = parseAnySms({ sender: 'VM-HDFCBK', body: 'Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 21/10/26\nRef 629412345678' });
    expect(hdfc.status === 'parsed' && hdfc.transaction.bank).toBe('hdfc');
    expect(parseAnySms({ sender: '+919876543210', body: 'Sent Rs 450 to you' })).toEqual({ status: 'ignored', reason: 'unknown_sender' });
  });
});
