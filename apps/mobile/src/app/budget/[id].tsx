import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { formatRupees, parseRupees, type MonthKey } from '@money-plant/core';
import { formatDate, formatMonth, formatWholeRupees as rupees } from '@/components/format';
import { Button, ErrorText, Field, ProgressBar, SectionTitle, colors } from '@/components/ui';
import { categoryBreakdown, currentMonth, monthOverview, setBudget, type BudgetLine, type CategoryBreakdown } from '@/lib/budgets';
import { categoryNames } from '@/lib/categories';
import { requestNotificationPermission } from '@/lib/notifications';
import { useLedger } from '@/lib/use-ledger';

async function load(id: string, month: MonthKey) {
  const categoryId = id === 'overall' ? null : id;
  const [overview, detail, names] = await Promise.all([monthOverview(month), categoryBreakdown(month, categoryId), categoryNames()]);
  const line = categoryId === null ? overview.overall : (overview.lines.find((l) => l.category?.id === categoryId) ?? null);
  return { line, detail, names };
}

/** BUD-1 to set a budget; BUD-3 to see where the money went against budget and the last 3 months. */
export default function BudgetDetail() {
  const params = useLocalSearchParams<{ id: string; month?: string }>();
  const month = params.month ?? currentMonth();
  const { data } = useLedger(() => load(params.id, month), null as { line: BudgetLine | null; detail: CategoryBreakdown; names: Map<string, string> } | null);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = data?.line?.limit ?? null;

  useEffect(() => {
    setLimit(current === null ? '' : formatRupees(current, { symbol: false }).replace(/\.00$/, ''));
  }, [current]);

  if (!data) return null;
  const { line, detail, names } = data;
  const title = params.id === 'overall' ? 'All spending' : (names.get(params.id) ?? 'Category');
  const categoryId = params.id === 'overall' ? null : params.id;

  async function save(remove = false) {
    const amount = remove ? null : parseRupees(limit);
    if (!remove && (amount === null || amount <= 0)) return setError('Enter the monthly budget as a number above zero');
    await setBudget(month, categoryId, amount);
    if (!remove) await requestNotificationPermission();
    router.back();
  }

  const diff = detail.total - detail.previousAverage;
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      <Text style={styles.meta}>{formatMonth(month)}</Text>
      <Text style={styles.big}>{rupees(detail.total)}</Text>
      {line?.limit != null && (
        <>
          <ProgressBar value={line.spent / line.limit} status={line.pace?.status} />
          <Text style={styles.meta}>
            Budget {rupees(line.limit)}
            {line.pace?.status === 'over' ? ` · over by ${rupees(line.spent - line.limit)}` : ` · ${rupees(line.limit - line.spent)} left`}
            {line.pace?.status === 'pace' ? ` · on pace for ${rupees(line.pace.projected)}` : ''}
          </Text>
        </>
      )}
      <Text style={styles.meta}>
        Last 3 months averaged {rupees(detail.previousAverage)}
        {detail.previousAverage > 0 ? ` · this month is ${diff >= 0 ? `${rupees(diff)} more` : `${rupees(-diff)} less`}` : ''}
      </Text>

      <View style={styles.form}>
        <Field label={`Monthly budget from ${formatMonth(month)} (₹)`} value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="5,000" />
        {error && <ErrorText>{error}</ErrorText>}
        <Button title="Save budget" onPress={() => save()} disabled={limit.trim() === ''} />
        {current !== null && <Button title="Remove budget" variant="secondary" onPress={() => save(true)} />}
      </View>

      {detail.byCategory.length > 1 && (
        <>
          <SectionTitle>By category</SectionTitle>
          {detail.byCategory.map((c) => (
            <Row key={c.categoryId} label={names.get(c.categoryId) ?? 'Category'} amount={c.amount} />
          ))}
        </>
      )}
      {detail.byMerchant.length > 0 && (
        <>
          <SectionTitle>Top merchants</SectionTitle>
          {detail.byMerchant.map((m) => (
            <Row key={m.merchant} label={`${m.merchant} · ${m.count}×`} amount={m.amount} />
          ))}
        </>
      )}
      {detail.largest.length > 0 && (
        <>
          <SectionTitle>Largest entries</SectionTitle>
          {detail.largest.map((item) => (
            <Pressable key={item.transactionId} onPress={() => router.push(`/transaction/${item.transactionId}`)}>
              <Row label={`${item.counterparty ?? 'Unknown'} · ${formatDate(item.occurredAt)}`} amount={item.amount} />
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Row({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.amount}>{rupees(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 8 },
  big: { fontSize: 32, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 14, color: colors.muted },
  form: { marginTop: 8, gap: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  label: { fontSize: 15, color: colors.text, flex: 1 },
  amount: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
});
