import { currencyInfo, type CurrencyCode } from './currency';
import type { Paise } from './money';

export type CsvCell = string | number | null | undefined;

/**
 * ACC-4: one CSV file from a header and rows (RFC 4180). Cells with commas,
 * quotes or line breaks are quoted. A cell starting with =, +, - or @ gets a
 * leading quote mark, so a spreadsheet never runs a payee name as a formula.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Paise as a plain decimal for spreadsheets, e.g. -123456 -> "-1234.56". No grouping, no symbol. */
export function rupeesDecimal(amount: Paise): string {
  const abs = Math.abs(amount);
  return `${amount < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Minor units as a plain decimal in their currency, for spreadsheets:
 * -123456 USD -> "-1234.56", 2500 JPY -> "2500", 3250 KWD -> "3.250" (decision 0017).
 */
export function minorDecimal(amount: number, currency: CurrencyCode): string {
  const { decimals } = currencyInfo(currency);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (decimals === 0) return `${sign}${abs}`;
  const unit = 10 ** decimals;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(decimals, '0')}`;
}
