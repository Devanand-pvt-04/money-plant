import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { daysBetween, paise } from '@money-plant/core';
import type { IouView } from '@/lib/ious';
import { formatAmount, formatDate } from './format';
import { colors } from './ui';

/** A person's balance: above zero they owe the user (green); below, the user owes them. */
export function Balance({ amount }: { amount: number }) {
  if (amount === 0) return <Text style={styles.amountMuted}>₹0</Text>;
  return <Text style={[styles.amount, amount > 0 && { color: colors.primary }]}>{formatAmount(paise(Math.abs(amount)))}</Text>;
}

const STATE_LABELS: Record<IouView['state'], string | null> = {
  personal: null,
  awaiting_them: 'waiting for them to confirm',
  awaiting_me: 'waiting for you to confirm',
  confirmed: 'confirmed by both',
  declined: 'they said this is wrong',
};

export function dueText(view: IouView, today: string): string | null {
  if (!view.dueDate || view.outstanding === 0) return null;
  const days = daysBetween(today, view.dueDate);
  if (days < 0) return `overdue since ${formatDate(`${view.dueDate}T12:00:00`)}`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due ${formatDate(`${view.dueDate}T12:00:00`)}`;
}

/** One IOU in a list: what for, its state, and what is still owed. */
export function IouRow({ view, today, first, showName }: { view: IouView; today: string; first: boolean; showName?: boolean }) {
  const settled = view.outstanding === 0;
  const parts = [
    view.direction === 'lent' ? (showName ? `${view.otherName} owes you` : 'You lent') : showName ? `You owe ${view.otherName}` : 'You borrowed',
    dueText(view, today),
    STATE_LABELS[view.state],
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/iou/${view.id}`)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={[styles.name, settled && styles.settled]} numberOfLines={1}>
          {view.reason ?? (view.direction === 'lent' ? 'Loan' : 'Borrowed')}
        </Text>
        <Text style={[styles.meta, view.state === 'declined' && { color: colors.danger }]} numberOfLines={2}>
          {parts.join(' · ')}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, settled && styles.settled, !settled && view.direction === 'lent' && { color: colors.primary }]}>
          {formatAmount(settled ? view.amount : view.outstanding)}
        </Text>
        {settled ? <Text style={styles.meta}>settled</Text> : view.outstanding !== view.amount && <Text style={styles.meta}>of {formatAmount(view.amount)}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  settled: { color: colors.muted, fontWeight: '400' },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  amountMuted: { fontSize: 15, color: colors.muted, fontVariant: ['tabular-nums'] },
});
