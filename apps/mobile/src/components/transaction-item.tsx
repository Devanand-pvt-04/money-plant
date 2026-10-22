import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatRupees, paise } from '@money-plant/core';
import { REVIEW_REASON_LABELS } from '@money-plant/matcher';
import type { TransactionRow } from '@/lib/ledger';
import { colors } from './ui';
import { formatDateTime } from './format';

export function transactionTitle({ tx, legs }: TransactionRow): string {
  if (tx.kind === 'transfer') {
    const from = legs.find((leg) => leg.amount < 0)?.accountName ?? '?';
    const to = legs.find((leg) => leg.amount > 0)?.accountName ?? '?';
    return `${from} → ${to}`;
  }
  return tx.counterparty ?? (tx.kind === 'income' ? 'Money in' : 'Money out');
}

/** One ledger entry in a list. Transfers show as neutral; money out is plain, money in is green. */
export function TransactionItem({ row, showReason = false }: { row: TransactionRow; showReason?: boolean }) {
  const { tx, legs } = row;
  const isTransfer = tx.kind === 'transfer';
  const amount = isTransfer ? Math.abs(legs[0]?.amount ?? 0) : (legs[0]?.amount ?? 0);
  const reason = tx.reviewReason ? REVIEW_REASON_LABELS[tx.reviewReason] : null;
  return (
    <Pressable onPress={() => router.push(`/transaction/${tx.id}`)} style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>{transactionTitle(row)}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatDateTime(tx.occurredAt)}
          {!isTransfer && legs[0] ? ` · ${legs[0].accountName}` : ''}
          {tx.status === 'pending' ? ' · to review' : ''}
        </Text>
        {showReason && reason && <Text style={styles.reason}>{reason}</Text>}
      </View>
      <Text style={[styles.amount, amount > 0 && !isTransfer && styles.credit]}>
        {formatRupees(paise(amount))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { flex: 1, marginRight: 12 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  reason: { fontSize: 13, color: colors.warning, marginTop: 4 },
  amount: { fontSize: 16, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  credit: { color: colors.primary },
});
