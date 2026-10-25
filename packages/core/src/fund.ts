import { paise, type Paise } from './money';
import { addDays, daysBetween, type DateKey } from './schedule';

/** A CAS as the CAS parser service returns it (NW-3). Amounts, units and NAVs are decimal strings. */
export interface CasStatement {
  statement: { from: string | null; to: string | null };
  cas_type: string | null;
  file_type: string | null;
  warnings: string[];
  folios: CasFolio[];
}

export interface CasFolio {
  folio: string | null;
  amc: string | null;
  schemes: CasScheme[];
}

export interface CasScheme {
  name: string | null;
  isin: string | null;
  amfi: string | null;
  rta: string | null;
  type: string | null;
  units: string | null;
  valuation: { date: string | null; nav: string | null; cost: string | null; value: string | null };
  transactions: CasTransaction[];
}

export interface CasTransaction {
  date: string | null;
  type: string | null;
  amount: string | null;
  units: string | null;
  nav: string | null;
}

/**
 * "123.4567" scaled to an integer with `places` decimals, rounding half away
 * from zero beyond them, without passing through a float. Null for anything
 * that isn't a plain decimal.
 */
export function scaleDecimal(text: string | null | undefined, places: number): number | null {
  const match = /^\s*(-)?(\d*)(?:\.(\d*))?\s*$/.exec(text ?? '');
  if (!match || (!match[2] && !match[3])) return null;
  const fraction = (match[3] ?? '').padEnd(places + 1, '0');
  let scaled = BigInt((match[2] || '0') + fraction.slice(0, places));
  if (Number(fraction[places]) >= 5) scaled += 1n;
  return Number(match[1] ? -scaled : scaled);
}

/** Paise from a rupee string, "2499.88" is 249988. */
export function rupeesToPaise(text: string | null | undefined): Paise | null {
  const value = scaleDecimal(text, 2);
  return value === null ? null : paise(value);
}

/** What `unitsE4` units are worth at `navE4`, to the nearest paisa. Both have 4 decimals. */
export function fundValue(unitsE4: number, navE4: number): Paise {
  const raw = BigInt(unitsE4) * BigInt(navE4);
  // units × NAV has 8 decimals of rupees; paise keep 2 of them.
  return paise(Number((raw + 500_000n) / 1_000_000n));
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "2026-09-30" or "30-Sep-2026" as a date key; null otherwise. */
export function casDate(text: string | null | undefined): DateKey | null {
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text.trim());
  const month = dmy && MONTHS[dmy[2]!.toLowerCase()];
  return dmy && month ? `${dmy[3]}-${month}-${dmy[1]!.padStart(2, '0')}` : null;
}

/** Money between a bank account and one scheme on one day: in is a purchase, out a redemption payout. */
export interface FundFlow {
  date: DateKey;
  direction: 'in' | 'out';
  amount: Paise;
}

const PURCHASES = new Set(['PURCHASE', 'PURCHASE_SIP']);

/**
 * The bank-side cash flows behind a scheme's CAS transactions, one per day
 * and direction. A purchase's bank debit is its amount plus stamp duty; a
 * redemption's credit is its amount less STT and TDS. Switches, dividend
 * reinvestments and mergers never touch a bank account, and dividend payouts
 * stay income.
 */
export function casFlows(transactions: readonly CasTransaction[]): FundFlow[] {
  const days = new Map<DateKey, { bought: number; stamp: number; reversed: number; sold: number; taxes: number }>();
  for (const t of transactions) {
    const date = casDate(t.date);
    const amount = rupeesToPaise(t.amount);
    if (!date || amount === null || !t.type) continue;
    const day = days.get(date) ?? { bought: 0, stamp: 0, reversed: 0, sold: 0, taxes: 0 };
    const size = Math.abs(amount);
    if (PURCHASES.has(t.type)) day.bought += size;
    else if (t.type === 'STAMP_DUTY_TAX') day.stamp += size;
    else if (t.type === 'REVERSAL') day.reversed += size;
    else if (t.type === 'REDEMPTION') day.sold += size;
    else if (t.type === 'STT_TAX' || t.type === 'TDS_TAX') day.taxes += size;
    days.set(date, day);
  }
  const flows: FundFlow[] = [];
  for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const paid = day.bought > 0 ? day.bought + day.stamp - day.reversed : 0;
    if (paid > 0) flows.push({ date, direction: 'in', amount: paise(paid) });
    const received = day.sold > 0 ? day.sold - day.taxes : 0;
    if (received > 0) flows.push({ date, direction: 'out', amount: paise(received) });
  }
  return flows;
}

/** A running SIP: the last SIP debit, if one landed in the 45 days before the statement ends. */
export function detectSip(transactions: readonly CasTransaction[], asOf: DateKey): { amount: Paise; day: number } | null {
  const sips = transactions
    .filter((t) => t.type === 'PURCHASE_SIP')
    .map((t) => ({ date: casDate(t.date), amount: rupeesToPaise(t.amount) }))
    .filter((t): t is { date: DateKey; amount: Paise } => t.date !== null && t.amount !== null && t.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = sips[sips.length - 1];
  if (!last || daysBetween(last.date, asOf) > 45) return null;
  const stamp = transactions
    .filter((t) => t.type === 'STAMP_DUTY_TAX' && casDate(t.date) === last.date)
    .reduce((sum, t) => sum + Math.abs(rupeesToPaise(t.amount) ?? 0), 0);
  return { amount: paise(last.amount + stamp), day: Number(last.date.slice(8, 10)) };
}

/** Payees that collect mutual fund money: the exchanges' clearing houses, the RTAs and the AMCs themselves. */
const FUND_PAYEE =
  /MUTUAL\s*FUNDS?|\bMF\b|\bAMC\b|\bBSE\b|ICCL|INDIAN\s*CLEARING|NSE\s*CLEARING|NSCCL|\bCAMS\b|KFIN|KARVY|GROWW|ZERODHA|COIN\b|KUVERA|PAYTM\s*MONEY|ET\s*MONEY|ASSET\s*MANAGEMENT/i;

/** Words of an AMC's name that identify it, "PPFAS Mutual Fund" gives PPFAS. */
function amcWords(amc: string | null): string[] {
  return (amc ?? '')
    .toUpperCase()
    .replace(/MUTUAL\s*FUND|ASSET\s*MANAGEMENT|COMPANY|LIMITED|LTD|PRIVATE|PVT|INDIA|\bMF\b|\bAMC\b|[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

/** Whether a bank entry's payee looks like it collects or pays mutual fund money, for this AMC or any. */
export function isFundPayee(counterparty: string | null, amc: string | null = null): boolean {
  if (!counterparty) return false;
  if (FUND_PAYEE.test(counterparty)) return true;
  const upper = counterparty.toUpperCase();
  return amcWords(amc).some((word) => upper.includes(word));
}

/** A bank entry that might be one side of a flow. */
export interface FlowCandidate {
  id: string;
  on: DateKey;
  /** Positive: what left or reached the bank account. */
  amount: Paise;
  direction: 'in' | 'out';
  counterparty: string | null;
}

/** Bank debits land up to a week before the CAS date (payment first, units on allotment); credits a day or two after. */
export const FLOW_DAYS_BEFORE = 7;
export const FLOW_DAYS_AFTER = 3;
/** Rounding on the statement: a debit within ₹1 of the flow matches. */
export const FLOW_TOLERANCE = 100;

/** Whether a bank entry could be this flow: same direction, close in amount and date, a fund payee. */
export function matchesFlow(flow: FundFlow, candidate: FlowCandidate, amc: string | null = null): boolean {
  if (candidate.direction !== flow.direction) return false;
  if (Math.abs(candidate.amount - flow.amount) > FLOW_TOLERANCE) return false;
  const from = flow.direction === 'in' ? addDays(flow.date, -FLOW_DAYS_BEFORE) : addDays(flow.date, -1);
  const to = flow.direction === 'in' ? addDays(flow.date, 1) : addDays(flow.date, FLOW_DAYS_AFTER);
  if (candidate.on < from || candidate.on > to) return false;
  return isFundPayee(candidate.counterparty, amc);
}

/**
 * Pairs flows with bank entries, closest date first, each entry used once.
 * `flows` carry the key of the scheme they belong to. Flows that no single
 * entry matches are tried again summed per day and direction, since one
 * debit can buy several schemes at once.
 */
export function pairFlows<K>(
  flows: readonly (FundFlow & { key: K; amc: string | null })[],
  candidates: readonly FlowCandidate[],
): { candidateId: string; parts: { key: K; amount: Paise }[] }[] {
  const used = new Set<string>();
  const pairs: { candidateId: string; parts: { key: K; amount: Paise }[] }[] = [];
  const pick = (flow: FundFlow, amc: string | null) =>
    candidates
      .filter((c) => !used.has(c.id) && matchesFlow(flow, c, amc))
      .sort((a, b) => Math.abs(daysBetween(a.on, flow.date)) - Math.abs(daysBetween(b.on, flow.date)) || Math.abs(a.amount - flow.amount) - Math.abs(b.amount - flow.amount))[0];

  const left: (FundFlow & { key: K; amc: string | null })[] = [];
  for (const flow of flows) {
    const match = pick(flow, flow.amc);
    if (!match) {
      left.push(flow);
      continue;
    }
    used.add(match.id);
    pairs.push({ candidateId: match.id, parts: [{ key: flow.key, amount: match.amount }] });
  }

  const groups = new Map<string, (FundFlow & { key: K; amc: string | null })[]>();
  for (const flow of left) groups.set(`${flow.date}|${flow.direction}`, [...(groups.get(`${flow.date}|${flow.direction}`) ?? []), flow]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const total = paise(group.reduce((sum, f) => sum + f.amount, 0));
    const match = pick({ date: group[0]!.date, direction: group[0]!.direction, amount: total }, null);
    if (!match) continue;
    used.add(match.id);
    // The bank amount is split in proportion; the last scheme takes the rounding.
    let given = 0;
    const parts = group.map((flow, i) => {
      const amount = i === group.length - 1 ? match.amount - given : Math.round((match.amount * flow.amount) / total);
      given += amount;
      return { key: flow.key, amount: paise(amount) };
    });
    pairs.push({ candidateId: match.id, parts });
  }
  return pairs;
}
