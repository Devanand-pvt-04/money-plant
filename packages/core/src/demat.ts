import { casDate, fundValue, rupeesToPaise, scaleDecimal } from './fund';
import { paise, type Paise } from './money';
import { dateKey, type DateKey } from './schedule';

/**
 * NW-5, NW-6 (decision 0014): shares, ETFs, gold bonds and bonds from an
 * NSDL or CDSL statement, and NPS schemes. Several holdings share one
 * account (one per demat account, one per PRAN), valued from each holding's
 * latest price.
 */

export type SecurityKind = 'share' | 'etf' | 'gold_bond' | 'bond';
export type HoldingKind = 'fund' | SecurityKind | 'nps';

/** Gold bonds and ETFs are listed among a statement's equities or bonds; their names give them away. */
export function securityKind(name: string | null, section: 'equity' | 'bond'): SecurityKind {
  const text = name ?? '';
  if (/\bSGB\b|SOVEREIGN\s+GOLD/i.test(text)) return 'gold_bond';
  if (section === 'bond') return 'bond';
  if (/\bETF\b|BEES\b|EXCHANGE\s+TRADED/i.test(text)) return 'etf';
  return 'share';
}

/** Brokers whose payee names show up on bank SMS when money moves to or from a trading account. */
const BROKERS: readonly { key: string; pattern: RegExp }[] = [
  { key: 'zerodha', pattern: /ZERODHA/ },
  { key: 'groww', pattern: /GROWW|NEXTBILLION/ },
  { key: 'upstox', pattern: /UPSTOX|RKSV/ },
  { key: 'angel', pattern: /ANGEL\s*(ONE|BROKING)/ },
  { key: 'icici', pattern: /ICICI\s*SEC|ICICIDIRECT|ICICI\s*DIRECT/ },
  { key: 'hdfc', pattern: /HDFC\s*SEC/ },
  { key: 'kotak', pattern: /KOTAK\s*SEC/ },
  { key: 'dhan', pattern: /\bDHAN\b|MONEYLICIOUS/ },
  { key: 'paytm', pattern: /PAYTM\s*MONEY/ },
  { key: '5paisa', pattern: /5\s*PAISA/ },
  { key: 'motilal', pattern: /MOTILAL/ },
  { key: 'sharekhan', pattern: /SHAREKHAN/ },
];

/** The broker a payee is, or null. */
export function brokerOf(counterparty: string | null): string | null {
  if (!counterparty) return null;
  const upper = counterparty.toUpperCase();
  return BROKERS.find((b) => b.pattern.test(upper))?.key ?? null;
}

/** A payment into NPS: to NPS Trust or a central record keeper (Protean, KFin, CAMS) for NPS. */
export function isNpsPayee(counterparty: string | null): boolean {
  return !!counterparty && /\bNPS\b|NPS\s*TRUST|PROTEAN|NSDL\s*E[-\s]?GOV|\bCRA\b/i.test(counterparty);
}

/** Whether a demat account's depository participant (its name on the statement) is that broker. */
export function brokerHolds(broker: string, dp: string | null): boolean {
  return !!dp && BROKERS.some((b) => b.key === broker && b.pattern.test(dp.toUpperCase()));
}

const ACRONYMS = new Set(['ICICI', 'HDFC', 'SBI', 'HSBC', 'IIFL', 'IDBI', 'SMC', 'JM']);

/** "ZERODHA BROKING LIMITED" reads as "Zerodha". */
export function shortBrokerName(dp: string | null): string {
  const words = (dp ?? '')
    .replace(/\b(PRIVATE|PVT|LIMITED|LTD|BROKING|SECURITIES|SECURITY|CAPITAL|SERVICES|FINANCIAL|INVEST(MENT)?S?|TECHNOLOGIES|INDIA)\b\.?/gi, ' ')
    .replace(/[^A-Za-z0-9& ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return 'Demat';
  return words.map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

/** The key an NPS scheme's NAV is kept under: its name, upper case, letters and digits only. */
export function npsKey(name: string): string {
  return `nps:${name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()}`;
}

function npsParts(name: string) {
  const upper = name.toUpperCase();
  return {
    manager: upper.match(/[A-Z]+/)?.[0] ?? '',
    scheme: upper.match(/SCHEME\s*[-–]?\s*([ECGA])\b/)?.[1] ?? (/CENTRAL\s+GOV/.test(upper) ? 'CG' : /STATE\s+GOV/.test(upper) ? 'SG' : null),
    tier: upper.match(/TIER\s*[-–]?\s*(II|I)\b/)?.[1] ?? 'I',
  };
}

/**
 * The NAV name an NPS scheme on a statement goes by: the same name, or else
 * the one from the same fund manager with the same scheme (E, C, G, A, or
 * central or state government) and tier. Null when none or several fit.
 */
export function npsMatch(name: string, navNames: readonly string[]): string | null {
  const key = npsKey(name);
  const exact = navNames.find((n) => npsKey(n) === key);
  if (exact) return exact;
  const want = npsParts(name);
  if (!want.scheme) return null;
  const fits = navNames.filter((n) => {
    const got = npsParts(n);
    return got.manager === want.manager && got.scheme === want.scheme && got.tier === want.tier;
  });
  return fits.length === 1 ? fits[0]! : null;
}

export interface MarketHolding {
  unitsE4: number;
  /** The price on the statement (4 decimals), used until a later one is known. */
  statementPriceE4: number | null;
  /** The latest price fetched since (4 decimals), or null. */
  latestPriceE4: number | null;
  /** What the user paid, or the statement's value standing in for it. */
  costPaise: number;
  costKnown: boolean;
}

export interface MarketValue {
  /** The holdings at their latest prices, plus money in or out since the statement. */
  value: Paise;
  /** Gain on the holdings whose cost is known, or null when none is. */
  gain: Paise | null;
  /** What was paid for the holdings whose cost is known. */
  invested: Paise;
  /** Holdings with no cost yet. */
  missingCost: number;
  /** Each holding's value today, in the order given. */
  values: Paise[];
}

/**
 * What an account of several holdings is worth today. `balance` is the
 * account's ledger balance: on the statement's date it is the sum of the
 * holdings' costs, so anything beyond that is money moved in or out since,
 * which counts as it is until the next statement.
 */
export function marketValue(list: readonly MarketHolding[], balance: Paise): MarketValue {
  let market = 0;
  let baseline = 0;
  let gain = 0;
  let invested = 0;
  let known = 0;
  const values: Paise[] = [];
  for (const h of list) {
    const price = h.latestPriceE4 ?? h.statementPriceE4;
    const worth = price === null ? paise(h.costPaise) : fundValue(h.unitsE4, price);
    values.push(worth);
    market += worth;
    baseline += h.costPaise;
    if (h.costKnown) {
      gain += worth - h.costPaise;
      invested += h.costPaise;
      known++;
    }
  }
  return {
    value: paise(market + balance - baseline),
    gain: known > 0 ? paise(gain) : null,
    invested: paise(invested),
    missingCost: list.length - known,
    values,
  };
}

/** What the user paid for a holding from an average price per unit: units × price, to the nearest paisa. */
export function costFromAverage(unitsE4: number, averagePriceE4: number): Paise {
  return fundValue(unitsE4, averagePriceE4);
}

/** One security on a depository statement, amounts and units as the service's decimal strings. */
export interface DematSecurity {
  name: string | null;
  isin: string | null;
  symbol?: string | null;
  amfi?: string | null;
  units: string | null;
  price: string | null;
  value: string | null;
  cost?: string | null;
}

/** An NSDL or CDSL statement as the parse-cas function returns it (NW-5). */
export interface DematStatement {
  kind: 'demat';
  statement: { from: string | null; to: string | null };
  file_type: string | null;
  warnings: string[];
  accounts: {
    depository: string | null;
    /** The depository participant, usually the broker. */
    dp: string | null;
    /** The client ID's last 4 characters. */
    client: string | null;
    equities: DematSecurity[];
    bonds: DematSecurity[];
    funds: DematSecurity[];
  }[];
  nps: {
    pran: string | null;
    schemes: { name: string | null; manager: string | null; tier: string | null; units: string | null; price: string | null; value: string | null }[];
  } | null;
}

/** One holding from a depository statement, ready to show and save. */
export interface DematItem {
  key: string;
  kind: HoldingKind;
  name: string;
  isin: string | null;
  symbol: string | null;
  amfiCode: string | null;
  unitsE4: number;
  priceE4: number | null;
  value: Paise;
  /** The cost the statement gives (demat mutual funds only). */
  cost: Paise | null;
}

/** One demat account or NPS account from the statement. */
export interface DematGroup {
  key: string;
  type: 'stock' | 'nps';
  name: string;
  institution: string | null;
  last4: string | null;
  items: DematItem[];
  asOf: DateKey;
}

const validIsin = (isin: string | null | undefined) => (isin && /^IN[A-Z0-9]{10}$/.test(isin) ? isin : null);
const clean = (text: string | null | undefined, max: number) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The accounts a statement adds: one Stocks account per demat account and
 * one NPS account. Mutual funds already imported from a CAMS or KFinTech CAS
 * (same ISIN) are left to that statement. Holdings with no units are skipped.
 */
export function dematGroups(statement: DematStatement, heldFundIsins: ReadonlySet<string> = new Set()): DematGroup[] {
  const asOf = casDate(statement.statement.to) ?? dateKey(new Date());
  const groups: DematGroup[] = [];
  for (const account of statement.accounts) {
    const key = `${account.depository ?? ''}:${account.client ?? account.dp ?? ''}`;
    const items: DematItem[] = [];
    const add = (kind: HoldingKind, s: (typeof account.equities)[number]) => {
      const unitsE4 = scaleDecimal(s.units, 4) ?? 0;
      const isin = validIsin(s.isin);
      if (unitsE4 <= 0 || (!isin && !s.name)) return;
      const priceE4 = scaleDecimal(s.price, 4);
      items.push({
        key: `${key}:${isin ?? clean(s.name, 200)}`,
        kind,
        name: clean(s.name, 200) || isin!,
        isin,
        symbol: s.symbol ? clean(s.symbol, 40) : null,
        amfiCode: s.amfi && /^\d{1,10}$/.test(s.amfi) ? s.amfi : null,
        unitsE4,
        priceE4,
        value: rupeesToPaise(s.value) ?? (priceE4 !== null ? fundValue(unitsE4, priceE4) : paise(0)),
        cost: rupeesToPaise(s.cost ?? null),
      });
    };
    for (const s of account.equities) add(securityKind(s.name, 'equity'), s);
    for (const s of account.bonds) add(securityKind(s.name, 'bond'), s);
    for (const s of account.funds) if (!(s.isin && heldFundIsins.has(s.isin))) add('fund', s);
    if (items.length === 0) continue;
    const client = account.client && /^[0-9]{4}$/.test(account.client) ? account.client : null;
    groups.push({ key, type: 'stock', name: `${shortBrokerName(account.dp)} demat`, institution: clean(account.dp, 120) || null, last4: client, items, asOf });
  }
  if (statement.nps && statement.nps.schemes.length > 0) {
    const key = `nps:${statement.nps.pran ?? ''}`;
    const items: DematItem[] = [];
    for (const s of statement.nps.schemes) {
      const unitsE4 = scaleDecimal(s.units, 4) ?? 0;
      const name = clean(s.name, 200);
      if (unitsE4 <= 0 || !name) continue;
      const priceE4 = scaleDecimal(s.price, 4);
      items.push({
        key: `${key}:${npsKey(name)}`,
        kind: 'nps',
        name,
        isin: null,
        symbol: null,
        amfiCode: null,
        unitsE4,
        priceE4,
        value: rupeesToPaise(s.value) ?? (priceE4 !== null ? fundValue(unitsE4, priceE4) : paise(0)),
        cost: null,
      });
    }
    const pran = statement.nps.pran && /^[0-9]{4}$/.test(statement.nps.pran) ? statement.nps.pran : null;
    if (items.length > 0) groups.push({ key, type: 'nps', name: 'NPS', institution: null, last4: pran, items, asOf });
  }
  return groups;
}

