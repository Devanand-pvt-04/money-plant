import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { formatRupees, paise, type Paise } from '@money-plant/core';
import type { LocalDeposit } from '@money-plant/db-schema';
import { Button, colors } from '@/components/ui';
import { formatDate, formatDateTime } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import { deleteAccount } from '@/lib/accounts';
import { depositValue, getDeposit } from '@/lib/deposits';
import { adoptBankBalance, listAccountBalances, listTransactions, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

async function load(id: string) {
  const [balances, rows, deposit] = await Promise.all([listAccountBalances(), listTransactions({ accountId: id, limit: 100 }), getDeposit(id)]);
  return { balance: balances.find((b) => b.account.id === id) ?? null, rows, deposit };
}

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useLedger(() => load(id), { balance: null as AccountBalance | null, rows: [] as TransactionRow[], deposit: null as LocalDeposit | null });
  if (!data.balance) return null;
  const { account, balance, value, reconciliation, typeLabel } = data.balance;
  const isDeposit = account.type === 'fd' || account.type === 'rd';

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
            {typeLabel}
            {account.institution ? ` · ${account.institution}` : ''}
            {account.last4 ? ` · ••${account.last4}` : ''}
          </Text>
          <Text style={styles.balance}>{formatRupees(value)}</Text>
          {isDeposit && <DepositCard accountId={account.id} deposit={data.deposit} balance={balance} />}
          {reconciliation && (
            <Text style={[styles.meta, reconciliation.flagged && styles.warn]}>
              Bank said {formatRupees(reconciliation.latest.anchor.balance)} on {formatDateTime(reconciliation.latest.anchor.observedAt)}
              {reconciliation.flagged
                ? ` · ledger off by ${formatRupees(paise(reconciliation.latest.gap))}`
                : ' · matches'}
            </Text>
          )}
          <View style={styles.actions}>
            {!data.deposit && (
              <View style={styles.action}>
                <Button title="Set balance" variant="secondary" onPress={() => router.push(`/account/balance?id=${account.id}`)} />
              </View>
            )}
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

/** NW-2: what went in, interest so far and maturity; or a prompt to add the terms. */
function DepositCard({ accountId, deposit, balance }: { accountId: string; deposit: LocalDeposit | null; balance: Paise }) {
  if (!deposit) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardText}>Add the interest rate and dates, and the app works out interest, maturity and reminders.</Text>
        <Button title="Add the terms" onPress={() => router.push(`/deposit?account=${accountId}`)} />
      </View>
    );
  }
  const { interest, maturity } = depositValue(deposit);
  const rate = `${(deposit.rateBp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const matures = formatDate(`${deposit.maturityDate}T12:00:00`);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/deposit?account=${accountId}`)} style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}>
      {deposit.closedAt ? (
        <Text style={styles.cardText}>Matured on {matures}. The payout is in your account and the interest is recorded as income.</Text>
      ) : (
        <>
          <Line label="Paid in" amount={balance} />
          <Line label={`Interest so far at ${rate}`} amount={interest} />
          <Line label={`At maturity, ${matures}`} amount={maturity} />
          <Text style={styles.note}>Interest is an estimate until the bank pays it. Tap to change the terms.</Text>
        </>
      )}
    </Pressable>
  );
}

function Line({ label, amount }: { label: string; amount: Paise }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineAmount}>{formatRupees(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 16, backgroundColor: colors.subtle, gap: 8, marginTop: 8 },
  pressedCard: { opacity: 0.85 },
  cardText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  lineLabel: { fontSize: 14, color: colors.muted, flex: 1 },
  lineAmount: { fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, color: colors.muted },
  list: { paddingHorizontal: 20, paddingVertical: 12 },
  header: { gap: 6, marginBottom: 4 },
  meta: { fontSize: 14, color: colors.muted },
  warn: { color: colors.warning },
  balance: { fontSize: 32, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { flex: 1 },
  section: { fontSize: 14, color: colors.muted, marginTop: 16 },
  footer: { marginTop: 24 },
});
