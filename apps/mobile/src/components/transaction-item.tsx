import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { TransactionRow } from '@/lib/ledger';
import { Initial, colors } from './ui';
import { formatAmount, formatSigned } from './format';

export function transactionTitle({ tx, legs }: TransactionRow): string {
  if (tx.kind === 'transfer') {
    const from = legs.find((leg) => leg.amount < 0)?.accountName ?? '?';
    const to = legs.find((leg) => leg.amount > 0)?.accountName ?? '?';
    return `${from} → ${to}`;
  }
  return tx.counterparty ?? (tx.kind === 'income' ? 'Money in' : 'Money out');
}

/** The entry's amount as shown in lists: transfers unsigned, money out with a minus, money in with a plus. */
export function displayAmount({ tx, legs }: TransactionRow): { text: string; color: string } {
  const amount = legs[0]?.amount ?? 0;
  if (tx.kind === 'transfer') return { text: formatAmount(Math.abs(amount)), color: colors.muted };
  return { text: formatSigned(amount), color: amount > 0 ? colors.primary : colors.text };
}

/** One ledger entry in a list. Transfers are muted; money out is plain, money in is green. */
export function TransactionItem({ row }: { row: TransactionRow }) {
  const { tx, legs } = row;
  const title = transactionTitle(row);
  const { text, color } = displayAmount(row);
  const detail = tx.kind === 'transfer' ? 'Transfer' : (row.category?.name ?? 'No category');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/transaction/${tx.id}`)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Initial name={title} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {detail}
          {tx.kind !== 'transfer' && legs[0] ? ` · ${legs[0].accountName}` : ''}
          {tx.status === 'pending' ? ' · to review' : ''}
        </Text>
      </View>
      <Text style={[styles.amount, { color }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8 },
  pressed: { opacity: 0.6 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
