import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Switch, Text, View } from 'react-native';
import { formatRupees, paise } from '@money-plant/core';
import { describePattern, type PatternMatch, type Rule } from '@money-plant/categoriser';
import { Button, colors } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import { useCategoryChange } from '@/components/use-category-change';
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
import { listRules } from '@/lib/rules-store';
import { useLedger } from '@/lib/use-ledger';

interface Proposal {
  rule: Rule & { match: PatternMatch };
  text: string;
  category: string;
}

async function load() {
  const [pending, balances, rules, names] = await Promise.all([
    listTransactions({ pendingOnly: true }),
    listAccountBalances(),
    listRules(),
    categoryNames(),
  ]);
  const accountName = new Map(balances.map((b) => [b.account.id, b.account.name]));
  const proposals = rules
    .filter((r): r is Rule & { match: PatternMatch } => r.status === 'proposed' && r.match.kind === 'pattern')
    .map((rule) => ({
      rule,
      text: describePattern(rule.match, rule.match.accountId ? (accountName.get(rule.match.accountId) ?? null) : null),
      category: names.get(rule.categoryId) ?? 'a category',
    }));
  return { pending, gaps: balances.filter((b) => b.reconciliation?.flagged), proposals };
}

/** LED-6 review inbox, with pattern proposals (CAT-8) and balance gaps from LED-7. */
export default function Review() {
  const { data } = useLedger(load, { pending: [] as TransactionRow[], gaps: [] as AccountBalance[], proposals: [] as Proposal[] });
  const { picker, change } = useCategoryChange();
  const nothing = data.gaps.length === 0 && data.proposals.length === 0;

  return (
    <>
      {picker}
      <FlatList
        data={data.pending}
        keyExtractor={(row) => row.tx.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {data.proposals.map((p) => (
              <PatternCard key={p.rule.id} proposal={p} />
            ))}
            {data.gaps.length > 0 && <Gaps gaps={data.gaps} />}
          </>
        }
        ListEmptyComponent={nothing ? <Text style={styles.empty}>Nothing to review.</Text> : undefined}
        renderItem={({ item }) => <ReviewCard row={item} onChangeCategory={change} />}
      />
    </>
  );
}

function ReviewCard({ row, onChangeCategory }: { row: TransactionRow; onChangeCategory: (id: string, flow: 'expense' | 'income', merchant: string | null) => void }) {
  const isTransfer = row.tx.kind === 'transfer';
  return (
    <View style={styles.card}>
      <TransactionItem row={row} showReason />
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title={isTransfer ? 'Yes, a transfer' : 'Looks right'} onPress={() => confirmEntry(row.tx.id)} />
        </View>
        {!isTransfer && row.category && (
          <View style={styles.action}>
            <Button
              title="Category…"
              variant="secondary"
              onPress={() => onChangeCategory(row.tx.id, row.tx.kind === 'income' ? 'income' : 'expense', row.tx.counterparty)}
            />
          </View>
        )}
        <View style={styles.action}>
          {isTransfer ? (
            <Button
              title="Not a transfer"
              variant="secondary"
              onPress={() => splitTransfer(row.tx.id).catch((e) => Alert.alert("Couldn't split", String(e?.message ?? e)))}
            />
          ) : (
            <Button
              title="Not a payment"
              variant="secondary"
              onPress={() =>
                Alert.alert('Remove this entry?', 'Use this for messages that were not a real payment.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(row.tx.id) },
                ])
              }
            />
          )}
        </View>
      </View>
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
  list: { padding: 16, gap: 12 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 16, marginTop: 48 },
  card: { gap: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  gaps: { gap: 12, marginBottom: 12 },
  gapCard: { padding: 16, borderRadius: 12, backgroundColor: colors.warningSurface, gap: 8 },
  patternCard: { padding: 16, borderRadius: 12, backgroundColor: '#E3F1E8', gap: 8, marginBottom: 12 },
  gapTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  gapText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 14, color: colors.text, flex: 1 },
});
