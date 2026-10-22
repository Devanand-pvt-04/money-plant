import { describe, expect, it } from 'vitest';
import { identifyBankSender, normaliseSender } from './senders';
import { parseBankText } from './sms';
import { parseNotification } from './notification';

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
