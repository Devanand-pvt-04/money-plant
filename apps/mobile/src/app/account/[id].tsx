import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ACCOUNT_TYPE_LABELS, formatRupees, paise } from '@money-plant/core';
import { Button, colors } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import { deleteAccount } from '@/lib/accounts';
import { adoptBankBalance, listAccountBalances, listTransactions, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

async function load(id: string) {
  const [balances, rows] = await Promise.all([listAccountBalances(), listTransactions({ accountId: id, limit: 100 })]);
  return { balance: balances.find((b) => b.account.id === id) ?? null, rows };
}

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useLedger(() => load(id), { balance: null as AccountBalance | null, rows: [] as TransactionRow[] });
  if (!data.balance) return null;
  const { account, balance, reconciliation } = data.balance;

  function confirmDelete() {
    Alert.alert('Delete account?', `${account.name} will be removed from all your devices.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(account.id).then(() => router.back()) },
    ]);
  }

  return (
    <FlatList
      data={data.rows}
      keyExtractor={(row) => row.tx.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: account.name }} />
          <Text style={styles.meta}>
            {ACCOUNT_TYPE_LABELS[account.type]}
            {account.institution ? ` · ${account.institution}` : ''}
            {account.last4 ? ` · ••${account.last4}` : ''}
          </Text>
          <Text style={styles.balance}>{formatRupees(balance)}</Text>
          {reconciliation && (
            <Text style={[styles.meta, reconciliation.flagged && styles.warn]}>
              Bank said {formatRupees(reconciliation.latest.anchor.balance)} on {formatDateTime(reconciliation.latest.anchor.observedAt)}
              {reconciliation.flagged
                ? ` · ledger off by ${formatRupees(paise(reconciliation.latest.gap))}`
                : ' · matches'}
            </Text>
          )}
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button title="Set balance" variant="secondary" onPress={() => router.push(`/account/balance?id=${account.id}`)} />
            </View>
            {reconciliation?.flagged && (
              <View style={styles.action}>
                <Button title="Use bank's balance" variant="secondary" onPress={() => adoptBankBalance(account.id)} />
              </View>
            )}
          </View>
          <Text style={styles.section}>Entries</Text>
        </View>
      }
      ListEmptyComponent={<Text style={styles.meta}>No entries yet.</Text>}
      ListFooterComponent={
        <View style={styles.footer}>
          <Button title="Delete account" variant="secondary" onPress={confirmDelete} />
        </View>
      }
      renderItem={({ item }) => <TransactionItem row={item} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  header: { gap: 6, marginBottom: 4 },
  meta: { fontSize: 14, color: colors.muted },
  warn: { color: colors.warning },
  balance: { fontSize: 32, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { flex: 1 },
  section: { fontSize: 14, color: colors.muted, marginTop: 16 },
  footer: { marginTop: 24 },
});
