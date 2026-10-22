import { parseRupees, type Paise } from './money';

/** The fields of a `upi://pay` link, as found in UPI QR codes (NPCI linking specification). */
export interface UpiPayment {
  /** Payee UPI ID (`pa`), e.g. "shop@okaxis". */
  payeeVpa: string;
  /** Payee name (`pn`). */
  payeeName?: string;
  /** Amount (`am`), if the QR fixes one. */
  amount?: Paise;
  /** Merchant category code (`mc`); present for merchant QRs. */
  merchantCode?: string;
  /** Transaction reference (`tr`). */
  reference?: string;
  /** Note (`tn`). */
  note?: string;
  /** All query parameters as read, so a hand-off can pass through ones we don't model (signed QRs). */
  params: Record<string, string>;
}

const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

/** Parses a `upi://pay?...` link. Returns null for anything that isn't a valid UPI payment link. */
export function parseUpiUri(text: string): UpiPayment | null {
  const match = /^upi:\/\/pay\?(.*)$/i.exec(text.trim());
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const part of match[1]!.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = (eq < 0 ? part : part.slice(0, eq)).toLowerCase();
    let value = eq < 0 ? '' : part.slice(eq + 1);
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    params[key] = value;
  }
  const payeeVpa = params.pa?.trim();
  if (!payeeVpa || !VPA.test(payeeVpa)) return null;
  let amount: Paise | undefined;
  if (params.am) {
    const parsed = parseRupees(params.am);
    if (parsed === null || parsed <= 0) return null;
    amount = parsed;
  }
  return {
    payeeVpa,
    payeeName: params.pn || undefined,
    amount,
    merchantCode: params.mc || undefined,
    reference: params.tr || undefined,
    note: params.tn || undefined,
    params,
  };
}

/** Formats paise as a UPI `am` value, e.g. 8000 -> "80.00". */
export function upiAmount(amount: Paise): string {
  if (amount <= 0) throw new RangeError('A UPI amount must be positive');
  return `${Math.floor(amount / 100)}.${(amount % 100).toString().padStart(2, '0')}`;
}

/**
 * Builds a `upi://pay` link to hand to the user's UPI app. Starts from the
 * scanned parameters so merchant fields pass through, then sets the amount,
 * reference and note we chose.
 */
export function buildUpiUri(
  payment: Pick<UpiPayment, 'payeeVpa' | 'params'> & { payeeName?: string },
  options: { amount: Paise; reference?: string; note?: string },
): string {
  const params: Record<string, string> = { ...payment.params, pa: payment.payeeVpa, cu: 'INR' };
  if (payment.payeeName) params.pn = payment.payeeName;
  params.am = upiAmount(options.amount);
  if (options.reference) params.tr = options.reference;
  if (options.note) params.tn = options.note;
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `upi://pay?${query}`;
}

export type UpiStatus = 'success' | 'failure' | 'submitted' | 'unknown';

/** The response string a UPI app returns, e.g. "txnId=...&responseCode=00&Status=SUCCESS&txnRef=...". */
export interface UpiResponse {
  status: UpiStatus;
  txnId?: string;
  responseCode?: string;
  approvalRef?: string;
  txnRef?: string;
  fields: Record<string, string>;
}

export function parseUpiResponse(text: string | null | undefined): UpiResponse {
  const fields: Record<string, string> = {};
  for (const part of (text ?? '').split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    let value = part.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep the raw value
    }
    fields[part.slice(0, eq).toLowerCase()] = value;
  }
  const raw = (fields.status ?? '').toUpperCase();
  const status: UpiStatus =
    raw === 'SUCCESS' ? 'success' : raw === 'FAILURE' || raw === 'FAILED' ? 'failure' : raw === 'SUBMITTED' ? 'submitted' : 'unknown';
  return {
    status,
    txnId: fields.txnid,
    responseCode: fields.responsecode,
    approvalRef: fields.approvalrefno,
    txnRef: fields.txnref,
    fields,
  };
}

