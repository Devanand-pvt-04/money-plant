import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { OVERALL, addMonths, type MonthKey } from '@money-plant/core';
import { formatMonth, formatWholeRupees } from '@/components/format';
import { Button, ProgressBar, SectionTitle, colors } from '@/components/ui';
import { currentMonth, monthOverview, setBudget, suggestBudgets, type BudgetLine, type MonthOverview } from '@/lib/budgets';
import { requestNotificationPermission } from '@/lib/notifications';
import { useLedger } from '@/lib/use-ledger';

const rupees = formatWholeRupees;

/** BUD-1 and BUD-2: this month's spending against budget, per category. */
export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const { data, reload } = useLedger(() => monthOverview(month), null as MonthOverview | null);
  // useLedger reloads on focus and on ledger changes; a different month needs a reload too.
  useEffect(() => {
    reload();
  }, [month, reload]);
  if (!data) return null;

  async function suggest() {
    const suggestions = await suggestBudgets(month);
    const missing = [...suggestions].filter(([key]) =>
      key === OVERALL ? data!.overall.limit === null : data!.lines.some((l) => l.category?.id === key && l.limit === null && !l.category.parentId),
    );
    if (missing.length === 0) return Alert.alert('Nothing to suggest', 'Every category with spending in the last 3 months already has a budget.');
    Alert.alert('Use suggested budgets?', `Sets ${missing.length} budgets from your average spending over the last 3 months, rounded up to ₹500. You can change each one.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set budgets',
        onPress: async () => {
          for (const [key, limit] of missing) await setBudget(month, key === OVERALL ? null : key, limit);
          await requestNotificationPermission();
        },
      },
    ]);
  }

  const withBudget = data.lines.filter((l) => l.limit !== null || (l.spent > 0 && !l.category?.parentId));
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <MonthNav month={month} onMonth={setMonth} />
      <Line line={data.overall} month={month} title="All spending" />
      <SectionTitle>Categories</SectionTitle>
      {withBudget.length === 0 && <Text style={styles.meta}>No spending this month yet.</Text>}
      {withBudget.map((line) => (
        <Line key={line.category!.id} line={line} month={month} title={line.category!.name} child={line.category!.parentId !== null} />
      ))}
      <View style={styles.actions}>
        <Button title="Suggest budgets from last 3 months" variant="secondary" onPress={suggest} />
        <Text style={styles.meta}>Tap a category to set its budget. A budget carries over to later months until you change it.</Text>
      </View>
    </ScrollView>
  );
}

function MonthNav({ month, onMonth }: { month: MonthKey; onMonth: (m: MonthKey) => void }) {
  return (
    <View style={styles.nav}>
      <Pressable hitSlop={12} onPress={() => onMonth(addMonths(month, -1))}>
        <Text style={styles.navArrow}>‹</Text>
      </Pressable>
      <Text style={styles.navTitle}>{formatMonth(month)}</Text>
      <Pressable hitSlop={12} disabled={month >= currentMonth()} onPress={() => onMonth(addMonths(month, 1))}>
        <Text style={[styles.navArrow, month >= currentMonth() && styles.disabled]}>›</Text>
      </Pressable>
    </View>
  );
}

function Line({ line, month, title, child = false }: { line: BudgetLine; month: MonthKey; title: string; child?: boolean }) {
  const status = line.pace?.status ?? 'ok';
  return (
    <Pressable
      onPress={() => router.push(`/budget/${line.category?.id ?? 'overall'}?month=${month}`)}
      style={({ pressed }) => [styles.card, child && styles.child, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <Text style={styles.name}>{title}</Text>
        <Text style={styles.amount}>
          {rupees(line.spent)}
          {line.limit !== null ? ` of ${rupees(line.limit)}` : ''}
        </Text>
      </View>
      {line.limit !== null && <ProgressBar value={line.spent / line.limit} status={status} />}
      {status === 'pace' && <Text style={styles.warn}>On pace for {rupees(line.pace!.projected)} by month end</Text>}
      {status === 'over' && <Text style={styles.over}>Over by {rupees(line.spent - line.limit!)}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  navArrow: { fontSize: 28, color: colors.primary, paddingHorizontal: 12 },
  navTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  disabled: { opacity: 0.3 },
  card: { padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 },
  child: { marginLeft: 16 },
  pressed: { backgroundColor: '#E3F1E8' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  amount: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  warn: { fontSize: 13, color: colors.warning },
  over: { fontSize: 13, color: colors.danger },
  meta: { fontSize: 13, color: colors.muted },
  actions: { marginTop: 16, gap: 8 },
});
