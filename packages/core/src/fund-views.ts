// Mutual fund holdings from a CAS, their value today, and which fund a SIP
// debit pays into (NW-1, NW-3). Pure functions, so they can be tested without
// the phone's database; apps/mobile/src/lib/funds.ts loads the rows and saves.

import { dateKey, type DateKey } from './schedule';
import {
  casDate,
  casFlows,
  costFromTransactions,
  detectSip,
  fundValue,
  isFundPayee,
  navOn,
  rupeesToPaise,
  scaleDecimal,
  unitsBought,
  FLOW_TOLERANCE,
  type CasStatement,
  type CasTransaction,
} from './fund';
import { paise, type Paise } from './money';

/** One scheme from a CAS, ready to show and save. */
export interface CasHolding {
  key: string;
  scheme: string;
  isin: string | null;
  amfiCode: string | null;
  folio: string | null;
  amc: string | null;
  unitsE4: number;
  cost: Paise;
  navE4: number | null;
  navDate: DateKey | null;
  value: Paise;
  asOf: DateKey;
  sip: { amount: Paise; day: number } | null;
  flows: ReturnType<typeof casFlows>;
  /** The statement's transactions for the scheme, kept for its chart and history. */
  transactions: CasTransaction[];
}

/**
 * The schemes still held, with units, cost and value as of the statement's
 * end. Closed folios are left out. `today` stands in when the statement has
 * no end date.
 */
export function casHoldings(statement: CasStatement, today: DateKey = dateKey(new Date())): CasHolding[] {
  const end = casDate(statement.statement.to) ?? today;
  const out: CasHolding[] = [];
  for (const folio of statement.folios) {
    for (const scheme of folio.schemes) {
      const unitsE4 = scaleDecimal(scheme.units, 4) ?? 0;
      if (unitsE4 <= 0 || !scheme.name) continue;
      const navE4 = scaleDecimal(scheme.valuation.nav, 4);
      const value = rupeesToPaise(scheme.valuation.value) ?? (navE4 !== null ? fundValue(unitsE4, navE4) : paise(0));
      const asOf = casDate(scheme.valuation.date) ?? end;
      const isin = scheme.isin && /^IN[A-Z0-9]{10}$/.test(scheme.isin) ? scheme.isin : null;
      const amfiCode = scheme.amfi && /^\d{1,10}$/.test(scheme.amfi) ? scheme.amfi : null;
      out.push({
        key: `${isin ?? amfiCode ?? scheme.name}:${folio.folio ?? ''}`,
        scheme: scheme.name.replace(/\s+/g, ' ').trim().slice(0, 200),
        isin,
        amfiCode,
        folio: folio.folio?.slice(0, 40) ?? null,
        amc: folio.amc?.slice(0, 120) ?? null,
        unitsE4,
        // The cost of the units still held. KFinTech statements often leave it out: then it is worked out
        // from the transactions, and only when those don't cover every unit does it fall back to the value.
        cost: rupeesToPaise(scheme.valuation.cost) ?? costFromTransactions(scheme.transactions, unitsE4) ?? value,
        navE4,
        navDate: navE4 !== null ? asOf : null,
        value,
        asOf,
        sip: detectSip(scheme.transactions, asOf),
        flows: casFlows(scheme.transactions),
        transactions: scheme.transactions,
      });
    }
  }
  return out;
}

/** "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" reads as "Parag Parikh Flexi Cap Fund". */
export function shortSchemeName(scheme: string): string {
  const name = scheme
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+-\s+/)[0]!
    .replace(/\s+/g, ' ')
    .trim();
  return (name || scheme).slice(0, 60);
}

/** The fields of a saved holding these functions read (LocalHolding in db-schema). */
export interface HoldingRow {
  accountId: string;
  amfiCode: string | null;
  isin: string | null;
  unitsE4: number;
  costPaise: number;
  navE4: number | null;
  navDate: string | null;
  asOf: string;
  amc: string | null;
  sipPaise: number | null;
  sipDay: number | null;
}

export interface FundValue {
  /** Units at the latest NAV, including estimated units for money paid in since the statement. */
  value: Paise;
  /** What the units are worth now, less what they cost (the statement's cost plus money paid in since). */
  gain: Paise;
  navE4: number | null;
  navDate: DateKey | null;
  /** Units bought since the statement, estimated until the next CAS (4 decimals). */
  estimatedUnitsE4: number;
}

/**
 * NW-1, NW-3: what one fund account is worth today. `latest` holds AMFI NAVs by
 * AMFI code and ISIN; it wins over the statement's NAV when it is as new or
 * newer. `balance` is the account's ledger balance. Money paid in after the
 * statement buys units at the NAV estimated for its day (navOn), so a SIP
 * grows with the fund; money taken out counts at what it was.
 */
export function holdingValue(
  holding: HoldingRow,
  latest: ReadonlyMap<string, { navE4: number; date: DateKey }>,
  flows: readonly { on: DateKey; amount: Paise }[],
  balance: Paise | undefined,
): FundValue {
  const amfi = (holding.amfiCode && latest.get(holding.amfiCode)) || (holding.isin && latest.get(holding.isin)) || null;
  const statementNav = holding.navE4 !== null && holding.navDate ? { navE4: holding.navE4, date: holding.navDate as DateKey } : null;
  const nav = amfi && (!holding.navDate || amfi.date >= holding.navDate) ? amfi : statementNav;
  const held = balance ?? paise(holding.costPaise);
  let estimatedUnitsE4 = 0;
  let paidIn = 0;
  for (const flow of flows) {
    if (flow.on <= holding.asOf || flow.amount <= 0) continue;
    const navE4 = navOn(flow.on, statementNav, nav);
    if (navE4 === null) continue;
    estimatedUnitsE4 += unitsBought(flow.amount, navE4);
    paidIn += flow.amount;
  }
  const market = nav ? fundValue(holding.unitsE4 + estimatedUnitsE4, nav.navE4) : paise(holding.costPaise + paidIn);
  // Whatever the ledger holds beyond the statement's cost and the money that bought units (money taken out) counts as it is.
  const rest = held - holding.costPaise - paidIn;
  return {
    value: paise(market + rest),
    gain: paise(market - holding.costPaise - paidIn),
    navE4: nav?.navE4 ?? null,
    navDate: nav?.date ?? null,
    estimatedUnitsE4,
  };
}

/**
 * NW-3: the fund a bank debit pays as its SIP, or null. It must come after
 * the statement, be within FLOW_TOLERANCE of the SIP amount, go to that
 * fund's AMC, and the fund must not already have had money that month
 * (`funded` holds "accountId|yyyy-mm"). When several fit, the one whose SIP
 * day is nearest the debit's day wins, counting across month ends.
 */
export function sipFundFor<H extends HoldingRow>(
  holdings: readonly H[],
  debit: { on: DateKey; amount: Paise; payee: string | null },
  funded: ReadonlySet<string>,
): H | null {
  const month = debit.on.slice(0, 7);
  const fits = holdings.filter(
    (h) =>
      h.sipPaise !== null &&
      debit.on > h.asOf &&
      Math.abs(debit.amount - h.sipPaise) <= FLOW_TOLERANCE &&
      !funded.has(`${h.accountId}|${month}`) &&
      isFundPayee(debit.payee, h.amc),
  );
  if (fits.length === 0) return null;
  const day = Number(debit.on.slice(8, 10));
  const gap = (h: H) => (h.sipDay === null ? 31 : Math.min(Math.abs(day - h.sipDay), 31 - Math.abs(day - h.sipDay)));
  return [...fits].sort((a, b) => gap(a) - gap(b))[0]!;
}
