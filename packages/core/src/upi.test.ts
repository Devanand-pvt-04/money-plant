import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { buildUpiUri, parseUpiResponse, parseUpiUri, upiAmount } from './upi';

describe('parseUpiUri', () => {
  it('reads a merchant QR', () => {
    const p = parseUpiUri('upi://pay?pa=shop.123@okaxis&pn=Sharma%20Tea%20Stall&mc=5812&tr=ABC1&am=80.50&cu=INR');
    expect(p).toMatchObject({
      payeeVpa: 'shop.123@okaxis',
      payeeName: 'Sharma Tea Stall',
      merchantCode: '5812',
      reference: 'ABC1',
      amount: 8050,
    });
  });

  it('reads a personal QR without an amount', () => {
    const p = parseUpiUri('UPI://pay?pa=9876543210@ybl&pn=Ravi+Kumar');
    expect(p?.payeeVpa).toBe('9876543210@ybl');
    expect(p?.payeeName).toBe('Ravi Kumar');
    expect(p?.amount).toBeUndefined();
  });

  it('rejects other links and bad fields', () => {
    expect(parseUpiUri('https://example.com')).toBeNull();
    expect(parseUpiUri('upi://pay?pn=NoVpa')).toBeNull();
    expect(parseUpiUri('upi://pay?pa=not-a-vpa')).toBeNull();
    expect(parseUpiUri('upi://pay?pa=a.b@okaxis&am=abc')).toBeNull();
    expect(parseUpiUri('upi://pay?pa=a.b@okaxis&am=0')).toBeNull();
  });
});

describe('buildUpiUri', () => {
  it('keeps scanned fields and sets amount, reference and note', () => {
    const scanned = parseUpiUri('upi://pay?pa=shop@okaxis&pn=Shop&mc=5812&sign=XYZ')!;
    const uri = buildUpiUri(scanned, { amount: paise(8000), reference: 'MP1', note: 'Tea' });
    const back = parseUpiUri(uri)!;
    expect(back.amount).toBe(8000);
    expect(back.reference).toBe('MP1');
    expect(back.note).toBe('Tea');
    expect(back.params.sign).toBe('XYZ');
    expect(back.params.cu).toBe('INR');
  });

  it('formats amounts without floating point', () => {
    expect(upiAmount(paise(5))).toBe('0.05');
    expect(upiAmount(paise(123456))).toBe('1234.56');
    expect(() => upiAmount(paise(0))).toThrow();
  });
});

describe('parseUpiResponse', () => {
  it('reads a success response', () => {
    const r = parseUpiResponse('txnId=AXI123&responseCode=00&Status=SUCCESS&txnRef=MP1&ApprovalRefNo=999');
    expect(r).toMatchObject({ status: 'success', txnId: 'AXI123', responseCode: '00', txnRef: 'MP1', approvalRef: '999' });
  });

  it('handles failure, submitted and missing responses', () => {
    expect(parseUpiResponse('Status=FAILURE').status).toBe('failure');
    expect(parseUpiResponse('status=submitted').status).toBe('submitted');
    expect(parseUpiResponse(undefined).status).toBe('unknown');
  });
});
