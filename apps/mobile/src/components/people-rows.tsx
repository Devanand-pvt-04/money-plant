import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { paise, type CurrencyCode } from '@money-plant/core';
import { itemTitle, statusText, type ItemView } from '@/lib/shared';
import { formatAmount, formatDate, formatSummary } from './format';
import { useColors, makeStyles } from './ui';

/** A person's balance: above zero they owe the user (green); below, the user owes them. */
export function Balance({ amount, currency }: { amount: number; currency?: CurrencyCode }) {
  const colors = useColors();
  const styles = useStyles();
  if (amount === 0) return <Text style={styles.amountMuted}>{formatSummary(0, currency)}</Text>;
  return <Text style={[styles.amount, amount > 0 && { color: colors.primary }]}>{formatSummary(paise(Math.abs(amount)), currency)}</Text>;
}

/** A balance with its sign, for lists: +₹1,800 they owe the user, −₹620 the user owes. */
export function Net({ amount, currency }: { amount: number; currency?: CurrencyCode }) {
  const colors = useColors();
  const styles = useStyles();
  if (amount === 0) return <Text style={styles.amountMuted}>{formatSummary(0, currency)}</Text>;
  const text = formatSummary(paise(Math.abs(amount)), currency);
  return <Text style={[styles.amount, { color: amount > 0 ? colors.primary : colors.danger }]}>{amount > 0 ? `+${text}` : `−${text}`}</Text>;
}

/** A person's balances, one line per currency, never added across currencies (decision 0017). */
export function NetByCurrency({ balances }: { balances: readonly { currency: CurrencyCode; amount: number }[] }) {
  const styles = useStyles();
  if (balances.length === 0) return <Net amount={0} />;
  if (balances.length === 1) return <Net amount={balances[0]!.amount} currency={balances[0]!.currency} />;
  return (
    <View style={styles.right}>
      {balances.map((b) => (
        <Net key={b.currency} amount={b.amount} currency={b.currency} />
      ))}
    </View>
  );
}

/** One shared item in a list: what it is, where it stands on this side, and its amount (decision 0026). */
export function ItemRow({ view, first }: { view: ItemView; first: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const done = view.status === 'linked' || view.status === 'declined';
  const attention = view.status === 'needs_answer' || view.status === 'needs_link';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/item/${view.id}`)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={[styles.name, view.status === 'declined' && styles.settled]} numberOfLines={1}>
          {view.reason ?? itemTitle(view)}
        </Text>
        <Text style={[styles.meta, attention && { color: colors.warning }, view.status === 'declined' && { color: colors.danger }]} numberOfLines={2}>
          {[view.reason ? itemTitle(view) : null, formatDate(`${view.occurredOn}T12:00:00`), done && !view.settledOutside ? null : statusText(view)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={[styles.amount, view.status === 'declined' && styles.settled, view.status !== 'declined' && { color: view.flow === 'to_them' ? colors.primary : colors.danger }]}>
        {`${view.flow === 'to_them' ? '+' : '−'}${formatAmount(view.amount, view.currency)}`}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
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
}));
