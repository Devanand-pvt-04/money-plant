import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatRupees, paise } from '@money-plant/core';
import { REVIEW_REASON_LABELS } from '@money-plant/matcher';
import { describePattern, type PatternMatch, type Rule } from '@money-plant/categoriser';
import { Button, Card, colors, radius } from '@/components/ui';
import { formatDateTime, formatDay, formatTime } from '@/components/format';
import { displayAmount, transactionTitle } from '@/components/transaction-item';
import { whyLabel } from '@/components/why';
import { useCategoryChange } from '@/components/use-category-change';
import { Suggestion } from '@/components/recurring-rows';
import { categoryNames } from '@/lib/categories';
import { acceptPattern, confirmEntry, declinePattern } from '@/lib/entries';
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
                {data.pending.length} left · about {Math.max(10, Math.ceil((data.pending.length * 8) / 10) * 10)} seconds
              </Text>
            )}
            {data.proposals.map((p) => (
              <PatternCard key={p.rule.id} proposal={p} />
            ))}
            {data.suggested.map((item) => (
              <Suggestion key={item.id} item={item} />
            ))}
            {data.gaps.length > 0 && <Gaps gaps={data.gaps} />}
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
  quiet: { alignSelf: 'center', paddingVertical: 4 },
  quietText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  done: { alignItems: 'center', gap: 10, marginTop: 96, paddingHorizontal: 40 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  doneText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  gaps: { gap: 12, marginBottom: 12 },
  gapCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 8 },
  patternCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.primarySurface, gap: 8, marginBottom: 12 },
  gapTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  gapText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 14, color: colors.text, flex: 1 },
});
