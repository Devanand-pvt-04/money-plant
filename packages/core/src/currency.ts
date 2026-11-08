/**
 * Currencies (decision 0017). Every amount is a whole number in the smallest
 * unit of its currency: paise for INR, cents for USD, fils for KWD (1/1000),
 * whole yen. Exchange rates are integers too, so conversion never touches
 * floating point.
 */

export type CurrencyCode = string;

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  /** Digits after the decimal point in the currency's smallest unit (ISO 4217). */
  decimals: 0 | 2 | 3;
  /** Shown before the amount. Distinct per currency, so "$" is only USD. */
  symbol: string;
}

const LIST: readonly CurrencyInfo[] = [
  { code: 'INR', name: 'Indian rupee', decimals: 2, symbol: '₹' },
  { code: 'USD', name: 'US dollar', decimals: 2, symbol: '$' },
  { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€' },
  { code: 'GBP', name: 'British pound', decimals: 2, symbol: '£' },
  { code: 'AED', name: 'UAE dirham', decimals: 2, symbol: 'AED ' },
  { code: 'SAR', name: 'Saudi riyal', decimals: 2, symbol: 'SAR ' },
  { code: 'QAR', name: 'Qatari riyal', decimals: 2, symbol: 'QAR ' },
  { code: 'KWD', name: 'Kuwaiti dinar', decimals: 3, symbol: 'KWD ' },
  { code: 'BHD', name: 'Bahraini dinar', decimals: 3, symbol: 'BHD ' },
  { code: 'OMR', name: 'Omani rial', decimals: 3, symbol: 'OMR ' },
  { code: 'SGD', name: 'Singapore dollar', decimals: 2, symbol: 'S$' },
  { code: 'AUD', name: 'Australian dollar', decimals: 2, symbol: 'A$' },
  { code: 'CAD', name: 'Canadian dollar', decimals: 2, symbol: 'CA$' },
  { code: 'NZD', name: 'New Zealand dollar', decimals: 2, symbol: 'NZ$' },
  { code: 'HKD', name: 'Hong Kong dollar', decimals: 2, symbol: 'HK$' },
  { code: 'JPY', name: 'Japanese yen', decimals: 0, symbol: '¥' },
  { code: 'CNY', name: 'Chinese yuan', decimals: 2, symbol: 'CN¥' },
  { code: 'KRW', name: 'South Korean won', decimals: 0, symbol: '₩' },
  { code: 'CHF', name: 'Swiss franc', decimals: 2, symbol: 'CHF ' },
  { code: 'SEK', name: 'Swedish krona', decimals: 2, symbol: 'SEK ' },
  { code: 'NOK', name: 'Norwegian krone', decimals: 2, symbol: 'NOK ' },
  { code: 'DKK', name: 'Danish krone', decimals: 2, symbol: 'DKK ' },
  { code: 'PLN', name: 'Polish złoty', decimals: 2, symbol: 'PLN ' },
  { code: 'CZK', name: 'Czech koruna', decimals: 2, symbol: 'CZK ' },
  { code: 'HUF', name: 'Hungarian forint', decimals: 2, symbol: 'HUF ' },
  { code: 'TRY', name: 'Turkish lira', decimals: 2, symbol: 'TRY ' },
  { code: 'ZAR', name: 'South African rand', decimals: 2, symbol: 'ZAR ' },
  { code: 'BRL', name: 'Brazilian real', decimals: 2, symbol: 'R$' },
  { code: 'MXN', name: 'Mexican peso', decimals: 2, symbol: 'MX$' },
  { code: 'THB', name: 'Thai baht', decimals: 2, symbol: 'THB ' },
  { code: 'MYR', name: 'Malaysian ringgit', decimals: 2, symbol: 'MYR ' },
  { code: 'IDR', name: 'Indonesian rupiah', decimals: 2, symbol: 'IDR ' },
  { code: 'PHP', name: 'Philippine peso', decimals: 2, symbol: '₱' },
  { code: 'VND', name: 'Vietnamese dong', decimals: 0, symbol: '₫' },
  { code: 'ILS', name: 'Israeli shekel', decimals: 2, symbol: '₪' },
  { code: 'LKR', name: 'Sri Lankan rupee', decimals: 2, symbol: 'LKR ' },
  { code: 'NPR', name: 'Nepalese rupee', decimals: 2, symbol: 'NPR ' },
  { code: 'BDT', name: 'Bangladeshi taka', decimals: 2, symbol: 'BDT ' },
  { code: 'PKR', name: 'Pakistani rupee', decimals: 2, symbol: 'PKR ' },
];

export const CURRENCIES: ReadonlyMap<CurrencyCode, CurrencyInfo> = new Map(LIST.map((info) => [info.code, info]));

export const DEFAULT_CURRENCY: CurrencyCode = 'INR';

/** A known ISO 4217 code this app can show and convert. */
export function isCurrency(code: unknown): code is CurrencyCode {
  return typeof code === 'string' && CURRENCIES.has(code);
}

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  const info = CURRENCIES.get(code);
  if (!info) throw new RangeError(`Unknown currency ${code}`);
  return info;
}

function groupDigits(whole: string, indian: boolean): string {
  if (!indian) return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
}

/**
 * Formats minor units with their currency: Indian grouping for rupees
 * (₹1,23,456.78), groups of three for the rest ($1,250.00, KWD 1,250.500).
 */
export function formatMoney(amount: number, currency: CurrencyCode, options: { symbol?: boolean } = {}): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Amount must be a safe integer, got ${amount}`);
  const { symbol = true } = options;
  const info = currencyInfo(currency);
  const negative = amount < 0;
  const digits = Math.abs(amount).toString().padStart(info.decimals + 1, '0');
  const whole = digits.slice(0, digits.length - info.decimals);
  const fraction = digits.slice(digits.length - info.decimals);
  const grouped = groupDigits(whole, currency === 'INR');
  const number = info.decimals ? `${grouped}.${fraction}` : grouped;
  return `${negative ? '-' : ''}${symbol ? info.symbol : ''}${number}`;
}

/**
 * Parses a typed amount ("1,250.5", "-10") into minor units of `currency`.
 * Commas group thousands, a dot marks decimals, and at most the currency's
 * decimals are allowed. Null when the text is not an amount.
 */
export function parseMoney(text: string, currency: CurrencyCode): number | null {
  const { decimals } = currencyInfo(currency);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim().replace(/,/g, ''));
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > decimals) return null;
  const value = Number(whole + fraction.padEnd(decimals, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return sign ? -value : value;
}

/** Scale of exchange rates: a rate of 1 is stored as 10^9. */
export const RATE_SCALE = 1_000_000_000n;

/**
 * How many major units of a currency one rupee buys, times 10^9. INR is
 * exactly 10^9; USD near 11,900,000 when a dollar costs about ₹84.
 */
export type RateE9 = bigint;

/** Rounds a / b to the nearest integer, halves to even. b must be positive. */
function divideHalfEven(a: bigint, b: bigint): bigint {
  const negative = a < 0n;
  const abs = negative ? -a : a;
  let q = abs / b;
  const r = abs % b;
  if (r * 2n > b || (r * 2n === b && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/**
 * Converts minor units of `from` into minor units of `to`, given each
 * currency's rate against the rupee. Integer arithmetic, one rounding.
 */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: { from: RateE9; to: RateE9 },
): number {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Amount must be a safe integer, got ${amount}`);
  if (from === to) return amount;
  if (rates.from <= 0n || rates.to <= 0n) throw new RangeError('Rates must be positive');
  const fromDecimals = BigInt(currencyInfo(from).decimals);
  const toDecimals = BigInt(currencyInfo(to).decimals);
  const numerator = BigInt(amount) * rates.to * 10n ** toDecimals;
  const denominator = rates.from * 10n ** fromDecimals;
  const result = divideHalfEven(numerator, denominator);
  const value = Number(result);
  if (!Number.isSafeInteger(value)) throw new RangeError('Converted amount is too large');
  return value;
}

/**
 * Reads a decimal rate written as text ("0.01189", "1.1678", "1e-7") into
 * a 10^9-scaled integer, rounding half to even.
 */
export function rateFromDecimal(text: string): RateE9 | null {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!match) return null;
  const [, whole, fraction = '', exponent = '0'] = match;
  const digits = BigInt(whole + fraction);
  const scale = fraction.length - Number(exponent);
  const value =
    scale >= 0 ? divideHalfEven(digits * RATE_SCALE, 10n ** BigInt(scale)) : digits * RATE_SCALE * 10n ** BigInt(-scale);
  return value > 0n ? value : null;
}

export interface FxRateRow {
  /** The day the rate is for, YYYY-MM-DD. */
  date: string;
  currency: CurrencyCode;
  perInrE9: RateE9;
}

/**
 * The rate for `currency` on `date`: the row for that day, or the nearest
 * earlier one, so weekends and holidays use the last published rate. The
 * rupee is always exactly 1. Null when nothing is known on or before the date.
 */
export function rateOn(rows: readonly FxRateRow[], currency: CurrencyCode, date: string): RateE9 | null {
  if (currency === 'INR') return RATE_SCALE;
  let best: FxRateRow | null = null;
  for (const row of rows) {
    if (row.currency !== currency || row.date > date) continue;
    if (!best || row.date > best.date) best = row;
  }
  return best?.perInrE9 ?? null;
}

/**
 * Converts an amount on a given day, or returns null when either rate is
 * unknown, so callers can mark a total as approximate rather than guess.
 */
export function convertOn(
  rows: readonly FxRateRow[],
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  date: string,
): number | null {
  if (from === to) return amount;
  const fromRate = rateOn(rows, from, date);
  const toRate = rateOn(rows, to, date);
  if (fromRate === null || toRate === null) return null;
  return convert(amount, from, to, { from: fromRate, to: toRate });
}
