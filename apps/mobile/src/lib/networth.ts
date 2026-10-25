import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { paise, type Paise } from '@money-plant/core';
import { postings, transactions } from '@money-plant/db-schema';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { netWorth, type AccountBalance } from './ledger';

const SNAPSHOT_PREFIX = 'networth.';
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export interface NetWorthPoint {
  /** "2026-10". */
  month: string;
  value: Paise;
}

/**
 * NW-4: net worth at the end of each of the last `months` months, this month
 * as it stands now. Each month's last value seen on this phone is kept, so
 * funds and deposits count at what they were worth then; months before that
 * are rebuilt from the ledger, with funds and deposits at what was paid in.
 * Months before the first entry are left out.
 */
export async function netWorthHistory(balances: readonly AccountBalance[], months = 6): Promise<NetWorthPoint[]> {
  const now = new Date();
  const current = monthKey(now);
  const value = netWorth(balances);
  await kvSet(`${SNAPSHOT_PREFIX}${current}`, String(value));

  const db = await getDb();
  const counted = balances.filter((b) => b.inNetWorth);
  const ids = counted.map((b) => b.account.id);
  if (ids.length === 0) return [{ month: current, value }];
  const first = db
    .select({ at: sql<string | null>`min(${transactions.occurredAt})` })
    .from(transactions)
    .where(isNull(transactions.deletedAt))
    .get()?.at;
  const opening = counted.reduce((sum, b) => sum + b.account.openingBalancePaise, 0);

  const points: NetWorthPoint[] = [];
  for (let back = months - 1; back >= 1; back--) {
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
    if (!first || first >= end.toISOString()) continue;
    const month = monthKey(start);
    const saved = await kvGet(`${SNAPSHOT_PREFIX}${month}`);
    if (saved !== null && /^-?\d+$/.test(saved)) {
      points.push({ month, value: paise(Number(saved)) });
      continue;
    }
    const posted = db
      .select({ total: sql<number>`coalesce(sum(${postings.amountPaise}), 0)` })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(inArray(postings.accountId, ids), isNull(transactions.deletedAt), lt(transactions.occurredAt, end.toISOString())))
      .get();
    points.push({ month, value: paise(opening + Number(posted?.total ?? 0)) });
  }
  points.push({ month: current, value });
  return points;
}
