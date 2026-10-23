import { flatten, listCategories, type CategoryNode } from './categories';
import { kvGet, kvSet } from './kv';
import { listAccountBalances, listTransactions, type AccountBalance } from './ledger';

const LAST_ACCOUNT_KEY = 'quickAdd.account';
/** Entries within this many minutes of the current time of day count extra. */
const NEAR_MINUTES = 90;

export interface QuickAddDefaults {
  accounts: AccountBalance[];
  accountId: string | null;
  /** Most likely categories first, for each direction. */
  suggestions: { debit: CategoryNode[]; credit: CategoryNode[] };
  /** Why the first suggestion leads, in a few words. */
  hint: { debit: string | null; credit: string | null };
}

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/**
 * CAP-7 smart defaults: the account used last time (else Cash), and the
 * categories the user picks most, weighted toward this time of day.
 */
export async function quickAddDefaults(now = new Date()): Promise<QuickAddDefaults> {
  const [balances, tree, recent, last] = await Promise.all([
    listAccountBalances(),
    listCategories(),
    listTransactions({ limit: 300 }),
    kvGet(LAST_ACCOUNT_KEY),
  ]);
  const accounts = balances.filter((b) => b.account.type !== 'loan');
  const accountId =
    accounts.find((b) => b.account.id === last)?.account.id ??
    accounts.find((b) => b.account.type === 'cash')?.account.id ??
    accounts[0]?.account.id ??
    null;

  const categories = flatten(tree).filter((c) => !c.system);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const nowMinutes = minutesOfDay(now);
  const rank = (flow: 'expense' | 'income') => {
    const score = new Map<string, number>();
    const near = new Map<string, number>();
    for (const row of recent) {
      if (row.tx.kind !== flow || !row.category) continue;
      const id = row.category.id;
      if (!byId.has(id)) continue;
      const gap = Math.abs(minutesOfDay(new Date(row.tx.occurredAt)) - nowMinutes);
      const isNear = Math.min(gap, 1440 - gap) <= NEAR_MINUTES;
      score.set(id, (score.get(id) ?? 0) + (isNear ? 3 : 1));
      if (isNear) near.set(id, (near.get(id) ?? 0) + 1);
    }
    const used = [...score].sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(id)!);
    // Fill up with top-level categories so a new user still gets choices.
    const rest = tree.filter((c) => !c.system && c.flow === flow && !used.includes(c));
    const list = [...used, ...rest];
    const top = used[0];
    const hint = top && (near.get(top.id) ?? 0) >= 2 ? `${top.name} is picked because you often use it around this time.` : null;
    return { list, hint };
  };
  const debit = rank('expense');
  const credit = rank('income');
  return { accounts, accountId, suggestions: { debit: debit.list, credit: credit.list }, hint: { debit: debit.hint, credit: credit.hint } };
}

export function rememberAccount(accountId: string): Promise<void> {
  return kvSet(LAST_ACCOUNT_KEY, accountId);
}
