import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { formatRupees, paise, type Paise } from '@money-plant/core';
import type { LocalDeposit, LocalHolding } from '@money-plant/db-schema';
import { Button, colors } from '@/components/ui';
import { formatDate, formatDateTime } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import { deleteAccount } from '@/lib/accounts';
import { depositValue, getDeposit } from '@/lib/deposits';
import { fundValues, listHoldings, type FundValue } from '@/lib/funds';
import { adoptBankBalance, listAccountBalances, listTransactions, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

async function load(id: string) {
  const [balances, rows, deposit, holdings] = await Promise.all([listAccountBalances(), listTransactions({ accountId: id, limit: 100 }), getDeposit(id), listHoldings()]);
  const balance = balances.find((b) => b.account.id === id) ?? null;
  const holding = holdings.find((h) => h.accountId === id) ?? null;
  const fund = holding && balance ? { holding, value: (await fundValues(new Map([[id, balance.balance]]))).get(id)! } : null;
  return { balance, rows, deposit, fund };
}

type Fund = { holding: LocalHolding; value: FundValue } | null;

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useLedger(() => load(id), { balance: null as AccountBalance | null, rows: [] as TransactionRow[], deposit: null as LocalDeposit | null, fund: null as Fund });
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
          {data.fund && <FundCard fund={data.fund} balance={balance} />}
          {reconciliation && (
            <Text style={[styles.meta, reconciliation.flagged && styles.warn]}>
              Bank said {formatRupees(reconciliation.latest.anchor.balance)} on {formatDateTime(reconciliation.latest.anchor.observedAt)}
              {reconciliation.flagged
                ? ` · ledger off by ${formatRupees(paise(reconciliation.latest.gap))}`
                : ' · matches'}
            </Text>
          )}
          <View style={styles.actions}>
            {!data.deposit && !data.fund && (
              <View style={styles.action}>
                <Button title="Set balance" variant="secondary" onPress={() => router.push(`/account/balance?id=${account.id}`)} />
              </View>
            )}
            {account.type === 'bank' && (
              <View style={styles.action}>
                <Button title="Import statement" variant="secondary" onPress={() => router.push(`/statement-import?account=${account.id}`)} />
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

/** NW-3: units, today's NAV and the gain on a fund imported from a CAS. */
function FundCard({ fund, balance }: { fund: NonNullable<Fund>; balance: Paise }) {
  const { holding, value } = fund;
  const units = (holding.unitsE4 / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 4 });
  const nav = value.navE4 !== null ? `₹${(value.navE4 / 10_000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : null;
  const since = balance - holding.costPaise;
  return (
    <View style={styles.card}>
      <Line label="Invested" amount={paise(holding.costPaise)} />
      <Line label={value.gain >= 0 ? 'Gain' : 'Loss'} amount={paise(Math.abs(value.gain))} />
      {since !== 0 && <Line label={since > 0 ? 'Paid in since the statement' : 'Taken out since the statement'} amount={paise(Math.abs(since))} />}
      <Text style={styles.note}>
        {units} units on {formatDate(`${holding.asOf}T12:00:00`)}
        {nav && value.navDate ? ` · NAV ${nav} on ${formatDate(`${value.navDate}T12:00:00`)}` : ''}
        {holding.sipPaise ? ` · SIP ${formatRupees(paise(holding.sipPaise))} around the ${ordinal(holding.sipDay ?? 1)}` : ''}
      </Text>
      <Text style={styles.note}>{holding.folio ? `Folio ${holding.folio}. ` : ''}Import a newer CAS to update the units.</Text>
    </View>
  );
}

function ordinal(day: number): string {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
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
