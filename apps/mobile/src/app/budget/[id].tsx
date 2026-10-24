import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import type { MonthKey, Paise } from '@money-plant/core';
import { BudgetSheet } from '@/components/budget-sheet';
import { categoryStyle } from '@/components/category-style';
import { formatDate, formatMonth, formatWholeRupees as rupees } from '@/components/format';
import { CategoryIcon } from '@/components/sheet';
import { ProgressBar, SectionTitle, colors, radius } from '@/components/ui';
import { categoryBreakdown, currentMonth, daysLeft, monthOverview, setBudget, type BudgetLine, type CategoryBreakdown } from '@/lib/budgets';
import { categoryNames, flatten, listCategories, type CategoryNode } from '@/lib/categories';
import { requestNotificationPermission } from '@/lib/notifications';
import { useLedger } from '@/lib/use-ledger';

interface Data {
  category: CategoryNode | null;
  line: BudgetLine | null;
  detail: CategoryBreakdown;
  names: Map<string, string>;
}

async function load(id: string, month: MonthKey): Promise<Data> {
  const categoryId = id === 'overall' ? null : id;
  const [overview, detail, names, tree] = await Promise.all([monthOverview(month), categoryBreakdown(month, categoryId), categoryNames(), listCategories()]);
  const category = categoryId === null ? null : (flatten(tree).find((c) => c.id === categoryId) ?? null);
  const line = categoryId === null ? overview.overall : (overview.lines.find((l) => l.category?.id === categoryId) ?? null);
  return { category, line, detail, names };
}

const shortMonth = (month: MonthKey) => formatMonth(month).slice(0, 3);
const monthName = (month: MonthKey) => formatMonth(month).split(' ')[0]!;

/**
 * BUD-1 and BUD-3: one category for a month. Its spend against budget, the
 * every-month budget and this month's override, the last 4 months, and where
 * the money went. Income categories show what came in, with no budget.
 */
export default function CategoryMonth() {
  const params = useLocalSearchParams<{ id: string; month?: string }>();
  const month = params.month ?? currentMonth();
  const { data } = useLedger(() => load(params.id, month), null as Data | null);
  const [editing, setEditing] = useState<'default' | 'month' | null>(null);
  if (!data) return null;

  const { category, line, detail, names } = data;
  const overall = params.id === 'overall';
  const categoryId = overall ? null : params.id;
  const income = category?.flow === 'income';
  const title = overall ? 'All spending' : (category?.name ?? 'Category');
  const style = categoryStyle(category?.key);
  const setting = line?.setting ?? { default: null, override: null, limit: null };
  const left = daysLeft(month);
  const subCount = category?.children.length ?? 0;

  async function save(target: 'default' | 'month', limit: Paise | null) {
    setEditing(null);
    await setBudget(target === 'default' ? null : month, categoryId, limit);
    if (limit !== null) await requestNotificationPermission();
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: '',
          headerRight:
            category && !category.system
              ? () => (
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/category/${category.id}`)}>
                    <Text style={styles.link}>Edit</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
      <View style={styles.head}>
        {overall ? (
          <View style={styles.overallIcon}>
            <Feather name="pie-chart" size={24} color={colors.primary} />
          </View>
        ) : (
          <CategoryIcon categoryKey={category?.key} size={48} />
        )}
        <View style={styles.grow}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {subCount > 0 ? `${subCount} ${subCount === 1 ? 'sub-category' : 'sub-categories'} · ` : ''}
            {formatMonth(month)}
          </Text>
        </View>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroText}>
          <Text style={styles.big}>{rupees(detail.total)}</Text>
          {line?.limit != null ? <Text style={styles.meta}> of {rupees(line.limit)} this month</Text> : <Text style={styles.meta}>{income ? ' came in' : ' this month'}</Text>}
        </Text>
        {line?.limit != null && <ProgressBar value={line.spent / line.limit} status={line.pace?.status} color={overall ? undefined : style.color} />}
        {line?.limit != null && <Text style={styles.meta}>{paceText(line, left)}</Text>}
      </View>

      {!income && (
        <>
          <SectionTitle>Budget</SectionTitle>
          <View style={styles.panel}>
            <BudgetRow
              title="Every month"
              note={setting.default === null ? 'No budget yet. It applies to every month unless you change one' : 'Applies to every month unless you change one'}
              amount={setting.default}
              onPress={() => setEditing('default')}
            />
            <BudgetRow
              title={`${monthName(month)} only`}
              note={
                setting.override === null
                  ? `Change ${monthName(month)} without touching other months`
                  : `${setting.default === null ? 'Set' : setting.override < setting.default ? 'Lower' : 'Higher'} this month${setting.default !== null ? ` · reset to ${rupees(setting.default)}` : ''}`
              }
              amount={setting.override}
              divided
              onPress={() => setEditing('month')}
            />
          </View>
        </>
      )}

      <SectionTitle>Last 4 months</SectionTitle>
      <History history={detail.history} color={overall ? colors.primary : style.color} />
      {detail.previousAverage > 0 && (
        <Text style={styles.meta}>
          The 3 months before averaged {rupees(detail.previousAverage)}.{' '}
          {detail.total >= detail.previousAverage
            ? `This month is ${rupees(detail.total - detail.previousAverage)} more.`
            : `This month is ${rupees(detail.previousAverage - detail.total)} less.`}
        </Text>
      )}

      {detail.byCategory.length > 1 && (
        <>
          <SectionTitle>By category</SectionTitle>
          {detail.byCategory.map((c) => (
            <Row key={c.categoryId} label={names.get(c.categoryId) ?? 'Category'} amount={c.amount} onPress={() => router.push(`/budget/${c.categoryId}?month=${month}`)} />
          ))}
        </>
      )}
      {detail.byMerchant.length > 0 && (
        <>
          <SectionTitle>Where it went</SectionTitle>
          {detail.byMerchant.map((m) => (
            <Row key={m.merchant} label={`${m.merchant} · ${m.count}×`} amount={m.amount} />
          ))}
        </>
      )}
      {detail.largest.length > 0 && (
        <>
          <SectionTitle>Largest entries</SectionTitle>
          {detail.largest.map((item) => (
            <Row
              key={item.transactionId}
              label={`${item.counterparty ?? 'Unknown'} · ${formatDate(item.occurredAt)}`}
              amount={item.amount}
              onPress={() => router.push(`/transaction/${item.transactionId}`)}
            />
          ))}
        </>
      )}

      <BudgetSheet
        visible={editing === 'default'}
        title={`${title}: every month`}
        note="Applies to every month unless you change one."
        value={setting.default}
        removeLabel={setting.default !== null ? 'Remove budget' : undefined}
        onSave={(limit) => save('default', limit)}
        onClose={() => setEditing(null)}
      />
      <BudgetSheet
        visible={editing === 'month'}
        title={`${title}: ${monthName(month)} only`}
        note={setting.default !== null ? `Other months stay at ${rupees(setting.default)}.` : 'Other months stay without a budget.'}
        value={setting.override ?? setting.default}
        removeLabel={setting.override !== null ? (setting.default !== null ? `Reset to ${rupees(setting.default)}` : 'Remove for this month') : undefined}
        onSave={(limit) => save('month', limit)}
        onClose={() => setEditing(null)}
      />
    </ScrollView>
  );
}

function paceText(line: BudgetLine, left: number | null): string {
  const limit = line.limit!;
  if (line.spent > limit) return `Over by ${rupees(line.spent - limit)}.`;
  const remaining = `${rupees(limit - line.spent)} left${left !== null ? ` for ${left} ${left === 1 ? 'day' : 'days'}` : ''}.`;
  return line.pace?.status === 'pace' ? `On pace for ${rupees(line.pace.projected)}. ${remaining}` : remaining;
}

function BudgetRow(props: { title: string; note: string; amount: Paise | null; divided?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.budgetRow, props.divided && styles.divided, pressed && styles.pressed]}>
      <View style={styles.grow}>
        <Text style={styles.name}>{props.title}</Text>
        <Text style={styles.note}>{props.note}</Text>
      </View>
      {props.amount !== null ? <Text style={styles.amount}>{rupees(props.amount)}</Text> : <Text style={styles.link}>Set</Text>}
    </Pressable>
  );
}

/** Four bars, oldest first, the last one in the category's colour. */
function History({ history, color }: { history: { month: MonthKey; total: Paise }[]; color: string }) {
  const max = Math.max(1, ...history.map((h) => h.total));
  return (
    <View style={styles.chart} accessible accessibilityLabel={history.map((h) => `${formatMonth(h.month)} ${rupees(h.total)}`).join(', ')}>
      {history.map((h, i) => {
        const current = i === history.length - 1;
        return (
          <View key={h.month} style={styles.column}>
            <Text style={[styles.barLabel, current && { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {rupees(h.total)}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: `${Math.max(2, (h.total / max) * 100)}%`, backgroundColor: current ? color : colors.track }]} />
            </View>
            <Text style={[styles.barMonth, current && { color: colors.text }]}>{shortMonth(h.month)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Row({ label, amount, onPress }: { label: string; amount: number; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowAmount}>{rupees(amount)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  overallIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  hero: { padding: 16, borderRadius: 20, backgroundColor: colors.subtle, gap: 10, marginTop: 4 },
  heroText: { color: colors.text },
  big: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  panel: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  note: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary },
  chart: { flexDirection: 'row', gap: 12, height: 150, paddingHorizontal: 4 },
  column: { flex: 1, alignItems: 'center', gap: 6 },
  barLabel: { fontSize: 11, color: colors.muted, fontVariant: ['tabular-nums'] },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
  barMonth: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  label: { fontSize: 15, color: colors.text, flex: 1 },
  rowAmount: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
});
