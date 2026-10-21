import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatRupees, paise } from '@money-plant/core';
import { Button, colors } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import {
  confirmTransaction,
  deleteTransaction,
  listAccountBalances,
  listTransactions,
  splitTransfer,
  adoptBankBalance,
  type AccountBalance,
  type TransactionRow,
} from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const [pending, balances] = await Promise.all([listTransactions({ pendingOnly: true }), listAccountBalances()]);
  return { pending, gaps: balances.filter((b) => b.reconciliation?.flagged) };
}

/** LED-6 review inbox, plus balance gaps from LED-7. */
export default function Review() {
  const { data } = useLedger(load, { pending: [] as TransactionRow[], gaps: [] as AccountBalance[] });

  return (
    <FlatList
      data={data.pending}
      keyExtractor={(row) => row.tx.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={data.gaps.length > 0 ? <Gaps gaps={data.gaps} /> : undefined}
      ListEmptyComponent={data.gaps.length === 0 ? <Text style={styles.empty}>Nothing to review.</Text> : undefined}
      renderItem={({ item }) => <ReviewCard row={item} />}
    />
  );
}

function ReviewCard({ row }: { row: TransactionRow }) {
  const isTransfer = row.tx.kind === 'transfer';
  return (
    <View style={styles.card}>
      <TransactionItem row={row} showReason />
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title={isTransfer ? 'Yes, a transfer' : 'Looks right'} onPress={() => confirmTransaction(row.tx.id)} />
        </View>
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
  gapTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  gapText: { fontSize: 14, color: colors.text, lineHeight: 20 },
});
