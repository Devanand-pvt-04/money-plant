import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatRupees, paise } from '@money-plant/core';
import { REVIEW_REASON_LABELS } from '@money-plant/matcher';
import { describePattern, type PatternMatch, type Rule } from '@money-plant/categoriser';
import { Button, Card, colors, radius } from '@/components/ui';
import { formatDate, formatDateTime, formatDay, formatTime, formatWholeRupees, reviewTime } from '@/components/format';
import { displayAmount, transactionTitle } from '@/components/transaction-item';
import { whyLabel } from '@/components/why';
import { useCategoryChange } from '@/components/use-category-change';
import { Suggestion } from '@/components/recurring-rows';
import { categoryNames } from '@/lib/categories';
import { acceptPattern, confirmEntries, confirmEntry, declinePattern } from '@/lib/entries';
import {
  deleteTransaction,
  listAccountBalances,
  listTransactions,
  splitTransfer,
  adoptBankBalance,
  type AccountBalance,
  type TransactionRow,
} from '@/lib/ledger';
import { listRecurring } from '@/lib/recurring';
import { listRules } from '@/lib/rules-store';
import type { RecurringPayment } from '@money-plant/matcher';
import { useLedger } from '@/lib/use-ledger';

interface Proposal {
  rule: Rule & { match: PatternMatch };
  text: string;
  category: string;
}

async function load() {
  const [pending, balances, rules, names, recurring] = await Promise.all([
    listTransactions({ pendingOnly: true }),
    listAccountBalances(),
    listRules(),
    categoryNames(),
    listRecurring(),
  ]);
  const accountName = new Map(balances.map((b) => [b.account.id, b.account.name]));
  const proposals = rules
    .filter((r): r is Rule & { match: PatternMatch } => r.status === 'proposed' && r.match.kind === 'pattern')
    .map((rule) => ({
      rule,
      text: describePattern(rule.match, rule.match.accountId ? (accountName.get(rule.match.accountId) ?? null) : null),
      category: names.get(rule.categoryId) ?? 'a category',
    }));
  const suggested = recurring.filter((r) => r.status === 'proposed');
  return { pending, gaps: balances.filter((b) => b.reconciliation?.flagged), proposals, suggested };
}

/** LED-6 review inbox, with pattern proposals (CAT-8) and balance gaps from LED-7. */
export default function Review() {
  const { data } = useLedger(load, {
    pending: [] as TransactionRow[],
    gaps: [] as AccountBalance[],
    proposals: [] as Proposal[],
    suggested: [] as RecurringPayment[],
  });
  const { picker, change } = useCategoryChange();
  const nothing = data.gaps.length === 0 && data.proposals.length === 0 && data.suggested.length === 0;

  return (
    <>
      {picker}
      <FlatList
        data={data.pending}
        keyExtractor={(row) => row.tx.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {data.pending.length > 0 && (
              <Text style={styles.count}>
                {data.pending.length} left · {reviewTime(data.pending.length)}
              </Text>
            )}
            {data.proposals.map((p) => (
              <PatternCard key={p.rule.id} proposal={p} />
            ))}
            {data.suggested.map((item) => (
              <Suggestion key={item.id} item={item} />
            ))}
            {data.gaps.length > 0 && <Gaps gaps={data.gaps} />}
            <BulkReview pending={data.pending} onChangeCategory={change} />
          </>
        }
        ListEmptyComponent={
          nothing ? (
            <View style={styles.done}>
              <View style={styles.doneIcon}>
                <Feather name="check" size={30} color={colors.primary} />
              </View>
              <Text style={styles.doneTitle}>All caught up</Text>
              <Text style={styles.doneText}>New entries from your bank SMS will show up here.</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => <ReviewCard row={item} onChangeCategory={change} />}
      />
    </>
  );
}

function ReviewCard({ row, onChangeCategory }: { row: TransactionRow; onChangeCategory: (id: string, flow: 'expense' | 'income', merchant: string | null) => void }) {
  const { tx, legs } = row;
  const isTransfer = tx.kind === 'transfer';
  const amount = displayAmount(row);
  const reason = tx.reviewReason ? REVIEW_REASON_LABELS[tx.reviewReason] : null;
  const why = whyLabel(tx, row.aiConfidence);
  return (
    <Card style={styles.card}>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/transaction/${tx.id}`)} style={styles.top}>
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={1}>
            {transactionTitle(row)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {!isTransfer && legs[0] ? `${legs[0].accountName} · ` : ''}
            {formatDay(tx.occurredAt)}, {formatTime(tx.occurredAt)}
          </Text>
        </View>
        <Text style={[styles.amount, { color: amount.color }]}>{amount.text}</Text>
      </Pressable>
      {!isTransfer && (
        <View style={styles.why}>
          <Text style={styles.category}>{row.category?.name ?? 'No category yet'}</Text>
          {(why || reason) && <Text style={styles.meta}>{[why, reason].filter(Boolean).join('. ')}</Text>}
        </View>
      )}
      {isTransfer && reason && <Text style={styles.meta}>{reason}</Text>}
      <View style={styles.actions}>
        <View style={styles.action}>
          {isTransfer ? (
            <Button
              title="Not a transfer"
              variant="secondary"
              onPress={() => splitTransfer(tx.id).catch((e) => Alert.alert("Couldn't split", String(e?.message ?? e)))}
            />
          ) : (
            <Button
              title={row.category ? 'Change' : 'Pick category'}
              variant="secondary"
              onPress={() => onChangeCategory(tx.id, tx.kind === 'income' ? 'income' : 'expense', tx.counterparty)}
            />
          )}
        </View>
        <View style={styles.action}>
          <Button title={isTransfer ? 'Yes, a transfer' : 'Looks right'} onPress={() => confirmEntry(tx.id)} />
        </View>
      </View>
      {/* IOU-1, SPL-1: a payment to or from a person is often a loan or a shared bill. */}
      {tx.reviewReason === 'person' && legs[0] && (
        <View style={styles.links}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/iou/new?from=${tx.id}`)}>
            <Text style={styles.link}>{legs[0].amount < 0 ? 'I lent this' : 'I borrowed this'}</Text>
          </Pressable>
          {tx.kind === 'expense' && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/split/${tx.id}`)}>
              <Text style={styles.link}>Split it</Text>
            </Pressable>
          )}
        </View>
      )}
      {!isTransfer && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          style={styles.quiet}
          onPress={() =>
            Alert.alert('Remove this entry?', 'Use this for messages that were not a real payment.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(tx.id) },
            ])
          }
        >
          <Text style={styles.quietText}>Not a real payment</Text>
        </Pressable>
      )}
    </Card>
  );
}

/** Review reasons a whole group can settle at once. The rest need a look at each entry. */
const BULK_REASONS = new Set(['person', 'pattern', 'category_unsure', 'low_confidence']);
const OLD_AFTER_DAYS = 30;
const SHOWN_GROUPS = 5;

interface PayeeGroup {
  key: string;
  title: string;
  rows: TransactionRow[];
  total: number;
  /** The category every entry shares, or null when they differ or have none. */
  category: string | null;
}

/** Groups pending entries by payee, so a backlog from the first import takes a few taps. */
function payeeGroups(pending: readonly TransactionRow[]): PayeeGroup[] {
  const groups = new Map<string, TransactionRow[]>();
  for (const row of pending) {
    if (row.tx.kind === 'transfer' || !row.tx.reviewReason || !BULK_REASONS.has(row.tx.reviewReason)) continue;
    const key = transactionTitle(row).trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .filter(([, rows]) => rows.length >= 2)
    .map(([key, rows]) => {
      const names = new Set(rows.map((r) => r.category?.name ?? null));
      return {
        key,
        title: transactionTitle(rows[0]!),
        rows,
        total: rows.reduce((sum, r) => sum + Math.abs(r.legs[0]?.amount ?? 0), 0),
        category: names.size === 1 ? [...names][0]! : null,
      };
    })
    .sort((a, b) => b.rows.length - a.rows.length);
}

/** Bulk review: whole payees at once, and a way to clear old imported entries. */
function BulkReview({
  pending,
  onChangeCategory,
}: {
  pending: TransactionRow[];
  onChangeCategory: (ids: string[], flow: 'expense' | 'income', merchant: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => payeeGroups(pending), [pending]);
  const cutoff = new Date(Date.now() - OLD_AFTER_DAYS * 86_400_000).toISOString();
  const old = pending.filter(
    (r) => r.tx.occurredAt < cutoff && r.tx.kind !== 'transfer' && r.tx.reviewReason !== null && BULK_REASONS.has(r.tx.reviewReason),
  );
  if (groups.length === 0 && old.length < 2) return null;
  const shown = showAll ? groups : groups.slice(0, SHOWN_GROUPS);

  function confirmOld() {
    Alert.alert(
      `Confirm ${old.length} older entries?`,
      `Entries from before ${formatDate(cutoff)} are confirmed as they are. They stay in Activity, and any without a category counts as Uncategorised in Budgets. You can still change each one.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void confirmEntries(old.map((r) => r.tx.id)) },
      ],
    );
  }

  return (
    <View style={styles.bulk}>
      {groups.length > 0 && <Text style={styles.bulkTitle}>Review by payee</Text>}
      {shown.map((group) => {
        const ids = group.rows.map((r) => r.tx.id);
        const flow = group.rows[0]!.tx.kind === 'income' ? 'income' : 'expense';
        return (
          <Card key={group.key} style={styles.card}>
            <View style={styles.top}>
              <View style={styles.grow}>
                <Text style={styles.title} numberOfLines={1}>
                  {group.title}
                </Text>
                <Text style={styles.meta}>
                  {group.rows.length} entries · {formatWholeRupees(group.total)} · {group.category ?? 'No category yet'}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button title="Category for all" variant="secondary" onPress={() => onChangeCategory(ids, flow, group.rows[0]!.tx.counterparty)} />
              </View>
              {group.category && (
                <View style={styles.action}>
                  <Button title="All look right" onPress={() => void confirmEntries(ids)} />
                </View>
              )}
            </View>
          </Card>
        );
      })}
      {groups.length > SHOWN_GROUPS && (
        <Pressable accessibilityRole="button" hitSlop={8} style={styles.quiet} onPress={() => setShowAll(!showAll)}>
          <Text style={styles.link}>{showAll ? 'Show fewer payees' : `Show ${groups.length - SHOWN_GROUPS} more payees`}</Text>
        </Pressable>
      )}
      {old.length >= 2 && (
        <View style={styles.gapCard}>
          <Text style={styles.gapTitle}>{old.length} entries are older than {OLD_AFTER_DAYS} days</Text>
          <Text style={styles.gapText}>Most of these came from importing your SMS history. Confirm them as they are and keep the inbox for new entries.</Text>
          <Button title={`Confirm ${old.length} older entries`} variant="secondary" onPress={confirmOld} />
        </View>
      )}
      {groups.length > 0 && <Text style={styles.bulkTitle}>One by one</Text>}
    </View>
  );
}

/** CAT-8: a pattern learned from the user's corrections, waiting for a yes or no. */
function PatternCard({ proposal }: { proposal: Proposal }) {
  const [autoConfirm, setAutoConfirm] = useState(false);
  return (
    <View style={styles.patternCard}>
      <Text style={styles.gapTitle}>New pattern: {proposal.category}</Text>
      <Text style={styles.gapText}>
        You categorised several entries like this the same way: {proposal.text}. Use {proposal.category} for these from now on?
      </Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Confirm matches without asking</Text>
        <Switch value={autoConfirm} onValueChange={setAutoConfirm} />
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title="Use pattern" onPress={() => acceptPattern(proposal.rule.id, autoConfirm)} />
        </View>
        <View style={styles.action}>
          <Button title="No thanks" variant="secondary" onPress={() => declinePattern(proposal.rule.id)} />
        </View>
      </View>
    </View>
  );
}

function Gaps({ gaps }: { gaps: AccountBalance[] }) {
  return (
    <View style={styles.gaps}>
      {gaps.map(({ account, reconciliation }) => {
        if (!reconciliation) return null;
        const { latest, windowStart } = reconciliation;
        return (
          <View key={account.id} style={styles.gapCard}>
            <Text style={styles.gapTitle}>{account.name} doesn't match the bank</Text>
            <Text style={styles.gapText}>
              The bank said {formatRupees(latest.anchor.balance)} on {formatDateTime(latest.anchor.observedAt)}; the ledger has{' '}
              {formatRupees(latest.computed)}.{' '}
              {latest.gap > 0 ? `${formatRupees(latest.gap)} of money in` : `${formatRupees(paise(-latest.gap))} of money out`} is
              probably missing
              {windowStart ? ` between ${formatDateTime(windowStart)} and ${formatDateTime(latest.anchor.observedAt)}` : ''}.
            </Text>
            <Button title="Use the bank's balance" variant="secondary" onPress={() => adoptBankBalance(account.id)} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 12 },
  count: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  card: { padding: 16, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
  amount: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  why: { alignItems: 'flex-start' },
  category: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.subtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary, paddingVertical: 4 },
  quiet: { alignSelf: 'center', paddingVertical: 4 },
  quietText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  done: { alignItems: 'center', gap: 10, marginTop: 96, paddingHorizontal: 40 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  doneText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  gaps: { gap: 12, marginBottom: 12 },
  bulk: { gap: 12, marginBottom: 12 },
  bulkTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 4 },
  gapCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 8 },
  patternCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.primarySurface, gap: 8, marginBottom: 12 },
  gapTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  gapText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 14, color: colors.text, flex: 1 },
});
