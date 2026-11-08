import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { and, gte, inArray, isNull } from 'drizzle-orm';
import { addReviewSeconds, dateKey, HEALTH_DAYS, healthFigures, type HealthEntry, type HealthFigures, type Paise } from '@money-plant/core';
import { sources, transactions } from '@money-plant/db-schema';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { listAccountBalances } from './ledger';
import { countSetAside } from './sync';

/** HOME-3: seconds in Review per day, kept on the phone only. */
const REVIEW_LOG_KEY = 'health.review_seconds';

function windowStart(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (HEALTH_DAYS - 1));
  return start;
}

async function readReviewLog(): Promise<Record<string, number>> {
  try {
    const parsed: unknown = JSON.parse((await kvGet(REVIEW_LOG_KEY)) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

let writing: Promise<void> = Promise.resolve();

function recordReviewSeconds(seconds: number): void {
  if (seconds < 1) return;
  writing = writing
    .then(async () => {
      const log = addReviewSeconds(await readReviewLog(), dateKey(new Date()), seconds, dateKey(windowStart()));
      await kvSet(REVIEW_LOG_KEY, JSON.stringify(log));
    })
    .catch(() => undefined);
}

/** Times the screen while it is focused and the app is in front. */
export function useReviewTimer(): void {
  useFocusEffect(
    useCallback(() => {
      let since: number | null = AppState.currentState === 'active' ? Date.now() : null;
      const stop = () => {
        if (since !== null) recordReviewSeconds((Date.now() - since) / 1000);
        since = null;
      };
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') since ??= Date.now();
        else stop();
      });
      return () => {
        subscription.remove();
        stop();
      };
    }, []),
  );
}

export interface BalanceHealth {
  accountId: string;
  name: string;
  /** Bank balance minus ledger balance at the latest SMS balance; positive means the ledger is missing money. */
  gap: Paise;
  observedAt: string;
}

export interface Health extends HealthFigures {
  balances: BalanceHealth[];
  /** Bank accounts with no balance from the bank yet. */
  unchecked: string[];
  /** Changed entries the server refused, waiting on this phone until they're edited. */
  unsynced: number;
}

export async function loadHealth(): Promise<Health> {
  const db = await getDb();
  const from = windowStart().toISOString();
  const txs = db
    .select({ id: transactions.id, kind: transactions.kind, status: transactions.status, categoryReason: transactions.categoryReason })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), gte(transactions.occurredAt, from)))
    .all();
  const kinds = new Map<string, string[]>();
  const ids = txs.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db
      .select({ transactionId: sources.transactionId, kind: sources.kind })
      .from(sources)
      .where(inArray(sources.transactionId, ids.slice(i, i + 500)))
      .all();
    for (const row of rows) kinds.set(row.transactionId, [...(kinds.get(row.transactionId) ?? []), row.kind]);
  }
  const entries: HealthEntry[] = txs.map((t) => ({ ...t, sources: kinds.get(t.id) ?? [] }));

  const log = await readReviewLog();
  const days = Array.from({ length: HEALTH_DAYS }, (_, i) => {
    const day = windowStart();
    day.setDate(day.getDate() + i);
    return log[dateKey(day)] ?? 0;
  });

  const banks = (await listAccountBalances()).filter((b) => b.account.type === 'bank');
  return {
    ...healthFigures(entries, days),
    balances: banks
      .filter((b) => b.reconciliation)
      .map((b) => ({
        accountId: b.account.id,
        name: b.account.name,
        gap: b.reconciliation!.latest.gap,
        observedAt: b.reconciliation!.latest.anchor.observedAt,
      })),
    unchecked: banks.filter((b) => !b.reconciliation).map((b) => b.account.name),
    unsynced: await countSetAside(),
  };
}
