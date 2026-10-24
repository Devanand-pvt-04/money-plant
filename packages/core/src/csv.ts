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
