import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, type MonthKey, type Paise } from '@money-plant/core';
import { askToReplaceBudgets } from '@/components/budget-overlap';
import { BudgetSheet } from '@/components/budget-sheet';
import { categoryStyle } from '@/components/category-style';
import { formatMonth, formatWholeRupees } from '@/components/format';
import { CategoryIcon } from '@/components/sheet';
import { Button, ProgressBar, colors, radius } from '@/components/ui';
import {
  currentMonth,
  daysLeft,
  incomeByCategory,
  monthOverview,
  setBudget,
  suggestBudgets,
  type BudgetLine,
  type MonthOverview,
} from '@/lib/budgets';
import type { CategoryNode } from '@/lib/categories';
import { requestNotificationPermission } from '@/lib/notifications';
import { useLedger } from '@/lib/use-ledger';

const rupees = formatWholeRupees;
type Segment = 'spending' | 'income';

async function load(month: MonthKey) {
  const [overview, income] = await Promise.all([monthOverview(month), incomeByCategory(month)]);
  return { overview, income };
}

const budgetHref = (id: string, month: MonthKey) => `/budget/${id}?month=${month}` as const;

/** BUD-1, BUD-2 and CAT-1: the month's spending against budget, and the categories behind it. */
export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const [segment, setSegment] = useState<Segment>('spending');
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; name: string; start: Paise | null } | null>(null);
  const { data, reload } = useLedger(() => load(month), null as { overview: MonthOverview; income: { category: CategoryNode; amount: Paise }[] } | null, 'budgets');
  // useLedger reloads on focus and on ledger changes; a different month needs a reload too.
  useEffect(() => {
    reload();
  }, [month, reload]);
  if (!data) return null;
  const { overview, income } = data;

  const roots = overview.lines.filter((l) => !l.category!.parentId);
  const children = (id: string) => overview.lines.filter((l) => l.category!.parentId === id);
  const active = (l: BudgetLine) => l.limit !== null || l.spent !== 0;
  const shown = roots.filter((l) => active(l) || children(l.category!.id).some(active) || (showAll && !l.category!.system));
  const hidden = roots.filter((l) => !l.category!.system).length - shown.filter((l) => !l.category!.system).length;

  async function suggest() {
    const suggestions = await suggestBudgets(month);
    // Only categories with no budget on them or on their sub-categories.
    const missing = [...suggestions].filter(([key]) => roots.some((l) => l.category!.id === key && l.limit === null) && !children(key).some((c) => c.limit !== null));
    if (missing.length === 0) return Alert.alert('Nothing to suggest', 'Every category with spending in the last 3 months already has a budget.');
    Alert.alert(
      'Use suggested budgets?',
      `Sets ${missing.length} budgets from your average spending over the last 3 months, rounded up to ₹500. They apply to every month, and you can change each one.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set budgets',
          onPress: async () => {
            for (const [key, limit] of missing) await setBudget(null, key, limit);
            await requestNotificationPermission();
          },
        },
      ],
    );
  }

  async function startBudget(category: CategoryNode) {
    const { proceed, start } = await askToReplaceBudgets(category.id, category.name);
    if (proceed) setEditing({ id: category.id, name: category.name, start });
  }

  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.months}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} onPress={() => setMonth(addMonths(month, -1))} style={styles.arrow}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.month}>{month === currentMonth() ? formatMonth(month).split(' ')[0] : formatMonth(month)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
            disabled={month >= currentMonth()}
            onPress={() => setMonth(addMonths(month, 1))}
            style={[styles.arrow, month >= currentMonth() && styles.disabled]}
          >
            <Feather name="chevron-right" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.segment}>
          {(['spending', 'income'] as const).map((s) => (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityState={{ selected: segment === s }}
              onPress={() => setSegment(s)}
              style={[styles.segmentItem, segment === s && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, segment === s && styles.segmentTextOn]}>{s === 'spending' ? 'Spending' : 'Income'}</Text>
            </Pressable>
          ))}
        </View>

        {segment === 'spending' ? (
          <>
            <Overall line={overview.overall} outside={overview.outside} month={month} elapsed={overview.elapsed} />
            <ReviewLink month={month < currentMonth() ? month : addMonths(month, -1)} />
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Categories</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/categories')}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            </View>
            {shown.length === 0 && <Text style={styles.meta}>No spending this month yet.</Text>}
            {shown.map((line) => (
              <CategoryCard
                key={line.category!.id}
                line={line}
                month={month}
                sub={children(line.category!.id).filter(active)}
                childBudgets={children(line.category!.id).some((c) => c.limit !== null)}
                open={open.has(line.category!.id)}
                onToggle={() => toggle(line.category!.id)}
                onSet={() => startBudget(line.category!)}
              />
            ))}
            {hidden > 0 && (
              <Pressable accessibilityRole="button" onPress={() => setShowAll(true)} style={styles.more}>
                <Text style={styles.link}>Show {hidden} more {hidden === 1 ? 'category' : 'categories'}</Text>
              </Pressable>
            )}
            {overview.moved.length > 0 && (
              <Text style={styles.meta}>
                Not counted as spending: {overview.moved.map((m) => `${m.category.name} ${rupees(m.amount)}`).join(', ')}. This money left your accounts
                but wasn't spent.
              </Text>
            )}
            <View style={styles.actions}>
              <Button title="Suggest budgets from last 3 months" variant="secondary" onPress={suggest} />
            </View>
          </>
        ) : (
          <IncomeList month={month} income={income} />
        )}
      </ScrollView>
      <BudgetSheet
        visible={editing !== null}
        title={`Budget for ${editing?.name ?? ''}`}
        note="Applies to every month. You can change one month from the category."
        value={editing?.start ?? null}
        onSave={async (limit) => {
          const target = editing!;
          setEditing(null);
          await setBudget(null, target.id, limit);
          await requestNotificationPermission();
        }}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function Overall({ line, outside, month, elapsed }: { line: BudgetLine; outside: Paise; month: MonthKey; elapsed: number }) {
  const left = daysLeft(month);
  const status = line.pace?.status ?? 'ok';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(budgetHref('overall', month))} style={({ pressed }) => [styles.overall, pressed && styles.pressed]}>
      <View style={styles.row}>
        <Text style={[styles.meta, styles.grow]}>{line.limit === null ? 'All spending' : 'Spent in your budgets'}</Text>
        {left !== null && <Text style={styles.days}>{left === 1 ? 'Last day' : `${left} days left`}</Text>}
      </View>
      <View style={styles.big}>
        <Text style={[styles.bigAmount, status === 'over' && { color: colors.danger }]}>{rupees(line.spent)}</Text>
        {line.limit !== null && <Text style={styles.meta}>of {rupees(line.limit)}</Text>}
      </View>
      {line.limit !== null && <ProgressBar value={line.spent / line.limit} status={status} marker={elapsed} />}
      <PaceNote line={line} />
      {line.limit === null ? (
        <Text style={styles.meta}>Set budgets on the categories you want to track. Your total budget is their sum.</Text>
      ) : (
        outside > 0 && <Text style={styles.meta}>{rupees(outside)} spent outside your budgets</Text>
      )}
    </Pressable>
  );
}

/** BUD-4: the month review for a past month, or last month's while viewing this one. */
function ReviewLink({ month }: { month: MonthKey }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/month-review?month=${month}`)} style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}>
      <Feather name="file-text" size={18} color={colors.primary} />
      <Text style={[styles.name, styles.grow]}>{formatMonth(month).split(' ')[0]} review</Text>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

function PaceNote({ line }: { line: BudgetLine }) {
  if (line.pace?.status === 'over') return <Text style={styles.over}>Over by {rupees(line.spent - line.limit!)}</Text>;
  if (line.pace?.status === 'pace') return <Text style={styles.warn}>On pace for {rupees(line.pace.projected)} by month end</Text>;
  return null;
}

function CategoryCard(props: { line: BudgetLine; month: MonthKey; sub: BudgetLine[]; childBudgets: boolean; open: boolean; onToggle: () => void; onSet: () => void }) {
  const { line, month, sub } = props;
  const category = line.category!;
  const style = categoryStyle(category.key);
  const status = line.pace?.status ?? 'ok';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(budgetHref(category.id, month))} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.row}>
        <CategoryIcon categoryKey={category.key} />
        <Text style={[styles.name, styles.grow]} numberOfLines={1}>
          {category.name}
        </Text>
        <Text style={[styles.amount, status === 'over' && { color: colors.warning }]}>
          {rupees(line.spent)}
          {line.limit !== null && <Text style={styles.of}> of {rupees(line.limit)}</Text>}
        </Text>
        {line.limit === null && !category.system && !props.childBudgets && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Set a budget for ${category.name}`} hitSlop={8} onPress={props.onSet}>
            <Text style={styles.link}>Set budget</Text>
          </Pressable>
        )}
        {sub.length > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel={props.open ? 'Hide sub-categories' : 'Show sub-categories'} hitSlop={10} onPress={props.onToggle}>
            <Feather name={props.open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {line.limit !== null && <ProgressBar value={line.spent / line.limit} status={status} color={style.color} />}
      <PaceNote line={line} />
      {props.childBudgets && <Text style={styles.meta}>Budgets are on its sub-categories</Text>}
      {(props.open || props.childBudgets) && (
        <View style={styles.children}>
          {sub.map((child) => (
            <Pressable
              key={child.category!.id}
              accessibilityRole="button"
              onPress={() => router.push(budgetHref(child.category!.id, month))}
              style={({ pressed }) => [styles.child, pressed && styles.pressed]}
            >
              <Text style={[styles.childText, styles.grow]} numberOfLines={1}>
                {child.category!.name}
              </Text>
              <Text style={[styles.childText, child.pace?.status === 'over' && { color: colors.warning }]}>
                {rupees(child.spent)}
                {child.limit !== null ? ` of ${rupees(child.limit)}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function IncomeList({ month, income }: { month: MonthKey; income: { category: CategoryNode; amount: Paise }[] }) {
  const total = income.reduce((sum, line) => sum + line.amount, 0);
  return (
    <>
      <View style={styles.overall}>
        <Text style={styles.meta}>Money in</Text>
        <Text style={[styles.bigAmount, total > 0 && { color: colors.primary }]}>{rupees(total)}</Text>
      </View>
      {income.length === 0 && <Text style={styles.meta}>No income this month yet.</Text>}
      {income.map(({ category, amount }) => (
        <Pressable
          key={category.id}
          accessibilityRole="button"
          onPress={() => router.push(budgetHref(category.id, month))}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.row}>
            <CategoryIcon categoryKey={category.key} />
            <Text style={[styles.name, styles.grow]} numberOfLines={1}>
              {category.name}
            </Text>
            <Text style={styles.amount}>{rupees(amount)}</Text>
          </View>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={() => router.push('/categories')} style={styles.more}>
        <Text style={styles.link}>Edit income categories</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  month: { fontSize: 16, fontWeight: '600', color: colors.text, minWidth: 120, textAlign: 'center' },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  overall: { padding: 16, borderRadius: 20, backgroundColor: colors.subtle, gap: 10 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  bigAmount: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  days: { fontSize: 12, fontWeight: '600', color: colors.primary },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  link: { fontSize: 13, fontWeight: '600', color: colors.primary },
  card: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8 },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  amount: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  of: { color: colors.muted },
  children: { paddingLeft: 46, gap: 2 },
  child: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  childText: { fontSize: 13, color: colors.secondary, fontVariant: ['tabular-nums'] },
  warn: { fontSize: 12, color: colors.warning },
  over: { fontSize: 12, color: colors.warning },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: 8 },
});
