import { describe, expect, it } from 'vitest';
import { anonymiseSms } from './anonymise';
import { parseBankText } from './sms';

describe('anonymiseSms (CAP-9)', () => {
  it('replaces amounts, account digits and references, and keeps the wording and dates', () => {
    const body = 'Rs 12000.00 debited from ICICI Bank Savings Account XX798 on 01-Oct-26 towards SHIVALIK SMALL  for UPI Mandate AutoPay Retrieval Ref No.629400000001';
    const out = anonymiseSms(body);
    expect(out).not.toMatch(/12000|798|629400000001/);
    expect(out).toContain('01-Oct-26');
    expect(out).toContain('debited from ICICI Bank Savings Account XX');
    expect(out).toContain('Rs 12345.67');
  });

  it('replaces people after from, keeping the shape', () => {
    const out = anonymiseSms('Acct XX798 is credited with Rs 5500.00 on 16-Oct-26 from Shanthi . UPI:629412345678-ICICI Bank.');
    expect(out).not.toContain('Shanthi');
    expect(out).toContain('from Ravi .');
    expect(out).not.toContain('629412345678');
  });

  it('replaces the person in a UPI ID and an email, keeping the bank handle', () => {
    const out = anonymiseSms('Sent Rs.250.00 from HDFC Bank A/C *4321 to deva.k@okhdfcbank on 05/11/26. Not you? Write to care@hdfcbank.net');
    expect(out).toContain('ravi@okhdfcbank');
    expect(out).not.toContain('deva.k');
    expect(out).toContain('user@example.com');
    expect(out).toContain('05/11/26');
    expect(out).not.toContain('4321');
  });

  it('handles names in capitals and stops at bank words', () => {
    const out = anonymiseSms('Dear PRIYA SHARMA, INR 1,250.00 credited to your A/c XX5678 by RAJESH KUMAR SINGH');
    expect(out).toContain('Dear RAVI KUMAR,');
    expect(out).toContain('by RAVI KUMAR');
    expect(out).toContain('credited to your A/c XX');
    expect(out).toContain('INR 1,234.56');
    expect(out).not.toMatch(/PRIYA|SHARMA|RAJESH|5678/);
  });

  it('keeps a message the parser could read readable', () => {
    const body = 'Rs 12000.00 debited from ICICI Bank Savings Account XX123 on 01-Oct-26 towards SHIVALIK SMALL  for UPI Mandate AutoPay Retrieval Ref No.629400000001';
    const result = parseBankText('icici', anonymiseSms(body));
    expect(result.status).toBe('parsed');
  });
});
