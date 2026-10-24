import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { CADENCE_LABELS } from '@money-plant/core';
import type { RecurringPayment } from '@money-plant/matcher';
import { dueLabel, setRecurringStatus, type UpcomingPayment } from '@/lib/recurring';
import { formatAmount, formatDate } from './format';
import { Button, colors, radius } from './ui';

/** One payment in a "coming up" list (HOME-1, REC-3). */
export function UpcomingRow({ upcoming, first }: { upcoming: UpcomingPayment; first: boolean }) {
  const { item, days, overdue, accountName, short } = upcoming;
  const status = overdue ? 'Not seen paid yet' : dueLabel(days);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/recurring/${item.id}`)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.meta, overdue && styles.warn]} numberOfLines={1}>
          {status} · {formatDate(`${item.nextDue}T12:00:00`)}
          {accountName ? ` · ${accountName}` : ''}
        </Text>
        {short !== null && <Text style={styles.warn}>May be short by {formatAmount(short)}</Text>}
      </View>
      <Text style={styles.amount}>{formatAmount(item.amount)}</Text>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A detected recurring payment waiting for a yes or no (REC-1). */
export function Suggestion({ item }: { item: RecurringPayment }) {
  return (
    <View style={styles.suggestion}>
      <Text style={styles.suggestionTitle}>
        {item.name}: {formatAmount(item.amount)} {CADENCE_LABELS[item.cadence].toLowerCase()}?
      </Text>
      <Text style={styles.suggestionText}>
        You paid this on a steady schedule. Track it to get reminders; next one around {formatDate(`${item.nextDue}T12:00:00`)}.
      </Text>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title="Track it" onPress={() => setRecurringStatus(item.id, 'active')} />
        </View>
        <View style={styles.action}>
          <Button title="Not recurring" variant="secondary" onPress={() => setRecurringStatus(item.id, 'declined')} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  warn: { fontSize: 13, color: colors.warning, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  suggestion: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.primarySurface, gap: 8, marginBottom: 8 },
  suggestionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  suggestionText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
