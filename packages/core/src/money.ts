/** An amount of money in paise (1 rupee = 100 paise). Always an integer. */
export type Paise = number & { readonly __brand: 'Paise' };

export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Paise must be a safe integer, got ${value}`);
  }
  return value as Paise;
}

/**
 * Parses a rupee amount as written in Indian bank messages and forms,
 * e.g. "1,23,456.78", "Rs. 450", "INR 2,000.5", "₹99". Returns null when the
 * text is not a valid amount. Uses string arithmetic, never floating point.
 */
export function parseRupees(text: string): Paise | null {
  const cleaned = text
    .trim()
    .replace(/^(?:rs\.?|inr|₹)\s*/i, '')
    .replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return paise(sign ? -value : value);
}

/** Formats paise with Indian digit grouping, e.g. 12345678 -> "₹1,23,456.78". */
export function formatRupees(amount: Paise, options: { symbol?: boolean } = {}): string {
  const { symbol = true } = options;
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100).toString();
  const fraction = (abs % 100).toString().padStart(2, '0');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`
    : lastThree;
  return `${negative ? '-' : ''}${symbol ? '₹' : ''}${grouped}.${fraction}`;
}
