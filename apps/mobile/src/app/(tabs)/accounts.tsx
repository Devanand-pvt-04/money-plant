import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import type { AccountType } from '@money-plant/core';
import { accountIcon, accountLabel } from '@/components/account-picker';
import { formatAmount, formatWholeRupees } from '@/components/format';
import { Card, colors, radius } from '@/components/ui';
import { listAccountBalances, netWorth, type AccountBalance } from '@/lib/ledger';
import { recurringOverview, type UpcomingPayment } from '@/lib/recurring';
import { useLedger } from '@/lib/use-ledger';

type Segment = 'cash' | 'investments';

/** The groups in each segment, in order. Custom types (ACC-6) go by their class. */
const GROUPS: Record<Segment, { title: string; has: (b: AccountBalance) => boolean }[]> = {
  cash: [
    { title: 'Bank accounts', has: (b) => b.account.type === 'bank' },
    { title: 'Cash and wallets', has: (b) => b.account.type === 'cash' || b.account.type === 'wallet' },
    { title: 'Credit cards', has: (b) => b.account.type === 'credit_card' },
    { title: 'Loans and dues', has: (b) => b.account.type === 'loan' || (b.account.type === 'custom' && b.liability) },
  ],
  investments: [
    { title: 'Deposits', has: (b) => b.account.type === 'fd' || b.account.type === 'rd' },
    { title: 'Funds and stocks', has: (b) => b.account.type === 'mutual_fund' || b.account.type === 'stock' },
    { title: 'Other investments', has: (b) => b.account.type === 'custom' && !b.liability },
  ],
};
const INVESTMENT_TYPES: ReadonlySet<AccountType> = new Set(['fd', 'rd', 'mutual_fund', 'stock']);
const inSegment = (b: AccountBalance): Segment =>
  INVESTMENT_TYPES.has(b.account.type) || (b.account.type === 'custom' && !b.liability) ? 'investments' : 'cash';

async function load() {
  const [balances, recurring] = await Promise.all([listAccountBalances(), recurringOverview()]);
  return { balances, upcoming: recurring.upcoming };
}

/** NAV-1, NW-1: net worth explained by its groups, and the recurring payments the accounts carry. */
export default function Accounts() {
  const { data } = useLedger(load, { balances: [] as AccountBalance[], upcoming: [] as UpcomingPayment[] });
  const [segment, setSegment] = useState<Segment>('cash');
  const counted = data.balances.filter((b) => b.inNetWorth);
  const assets = counted.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);
  const liabilities = counted.filter((b) => b.balance < 0).reduce((s, b) => s - b.balance, 0);
  const shown = data.balances.filter((b) => inSegment(b) === segment);
  const next = data.upcoming[0];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.meta}>Net worth</Text>
        <Text style={styles.heroAmount}>{formatWholeRupees(netWorth(data.balances))}</Text>
        <View style={styles.split}>
          <View style={styles.grow}>
            <Text style={styles.meta}>Assets</Text>
            <Text style={[styles.splitAmount, { color: colors.primary }]}>{formatWholeRupees(assets)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.meta}>Liabilities</Text>
            <Text style={[styles.splitAmount, liabilities > 0 && { color: colors.danger }]}>{formatWholeRupees(liabilities)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.segment}>
        {(['cash', 'investments'] as const).map((s) => (
          <Pressable
            key={s}
            accessibilityRole="radio"
            accessibilityState={{ selected: segment === s }}
            onPress={() => setSegment(s)}
            style={[styles.segmentItem, segment === s && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextOn]}>{s === 'cash' ? 'Cash and cards' : 'Investments'}</Text>
          </Pressable>
        ))}
      </View>

      {shown.length === 0 ? (
        <Text style={styles.empty}>
          {segment === 'cash'
            ? 'No accounts yet. Read your bank SMS, or add accounts, cards and cash by hand.'
            : 'Add FDs, funds or your own types like PF and gold. CAS import and daily prices come in a later update.'}
        </Text>
      ) : (
        GROUPS[segment].map((group) => {
          const rows = shown.filter(group.has);
          if (rows.length === 0) return null;
          const total = rows.reduce((s, b) => s + b.balance, 0);
          return (
            <View key={group.title} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                <Text style={[styles.groupTotal, total < 0 && { color: colors.danger }]}>{formatAmount(total)}</Text>
              </View>
              <Card>
                {rows.map((item, i) => (
                  <AccountRow key={item.account.id} item={item} first={i === 0} />
                ))}
              </Card>
            </View>
          );
        })
      )}

      <Pressable accessibilityRole="button" onPress={() => router.push('/add-account')} style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
        <Feather name="plus" size={18} color={colors.primary} />
        <Text style={styles.addText}>Add account</Text>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push('/recurring')} style={({ pressed }) => [styles.recurring, pressed && styles.pressed]}>
        <Feather name="repeat" size={18} color={colors.muted} />
        <View style={styles.grow}>
          <Text style={styles.name}>Recurring payments</Text>
          <Text style={styles.meta}>
            {next ? `${data.upcoming.length} active · next ${next.item.name} ${formatAmount(next.item.amount)}` : 'Autopays, EMIs and subscriptions'}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.muted} />
      </Pressable>
    </ScrollView>
  );
}

function AccountRow({ item, first }: { item: AccountBalance; first: boolean }) {
  const { account, balance, reconciliation, typeLabel } = item;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/account/${account.id}`)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Feather name={accountIcon(account.type)} size={16} color={colors.secondary} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.name}>{accountLabel(account)}</Text>
        <Text style={styles.meta}>
          {typeLabel}
          {account.institution ? ` · ${account.institution}` : ''}
        </Text>
        {reconciliation?.flagged && <Text style={styles.warn}>Off from the bank by {formatAmount(Math.abs(reconciliation.latest.gap))}</Text>}
      </View>
      <Text style={[styles.amount, balance < 0 && { color: colors.danger }]}>{formatAmount(balance)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  hero: { padding: 16, borderRadius: 20, backgroundColor: colors.subtle, gap: 6 },
  heroAmount: { fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  split: { flexDirection: 'row', gap: 10, marginTop: 6 },
  splitAmount: { fontSize: 16, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'], marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20, marginVertical: 8 },
  group: { gap: 8 },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 },
  groupTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  groupTotal: { fontSize: 14, color: colors.secondary, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  warn: { fontSize: 12, color: colors.warning, marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
  },
  addText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  recurring: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
