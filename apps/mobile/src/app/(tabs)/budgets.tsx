import { useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { BUDGET_SORTS, addMonths, combineBudgets, paise, sortBudgets, type BudgetSort, type MonthKey, type Paise, type SortableBudget } from '@money-plant/core';
import { askToReplaceBudgets } from '@/components/budget-overlap';
import { BudgetSheet } from '@/components/budget-sheet';
import { categoryStyle } from '@/components/category-style';
import { formatMonth, formatWholeRupees } from '@/components/format';
import { CategoryIcon, Sheet } from '@/components/sheet';
import { ErrorText, Button, MoneyCard, ProgressBar, colors, figures, radius } from '@/components/ui';
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
import { kvGet, kvSet } from '@/lib/kv';
import { requestNotificationPermission } from '@/lib/notifications';
import { usePullToRefresh } from '@/lib/refresh';
import { useLedger } from '@/lib/use-ledger';

const rupees = formatWholeRupees;
type Segment = 'spending' | 'income';

async function load(month: MonthKey) {
  const [overview, income] = await Promise.all([monthOverview(month), incomeByCategory(month)]);
  return { overview, income };
}

const SORT_KEY = 'budgets.sort';
const isSort = (value: string | null): value is BudgetSort => BUDGET_SORTS.some((s) => s.key === value);
const sortable = (l: BudgetLine): SortableBudget => ({ name: l.category!.name, spent: l.spent, limit: l.limit, status: l.pace?.status ?? null });

/** The order the user picked, remembered on this phone. */
function useBudgetSort() {
  const [sort, setSort] = useState<BudgetSort>('attention');
  useEffect(() => {
    kvGet(SORT_KEY)
      .then((saved) => isSort(saved) && setSort(saved))
      .catch(() => {});
  }, []);
  const choose = (next: BudgetSort) => {
    setSort(next);
    kvSet(SORT_KEY, next).catch(() => {});
  };
  return [sort, choose] as const;
}

const budgetHref = (id: string, month: MonthKey) => `/budget/${id}?month=${month}` as const;

/** BUD-1, BUD-2 and CAT-1: the month's spending against budget, and the categories behind it. */
export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const [segment, setSegment] = useState<Segment>('spending');
  const [showAll, setShowAll] = useState(false);
  // Categories the user opened or closed; one with sub-category budgets starts open.
  const [sort, setSort] = useBudgetSort();
  const [sorting, setSorting] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; name: string; start: Paise | null } | null>(null);
  const { data, reload } = useLedger(() => load(month), null as { overview: MonthOverview; income: { category: CategoryNode; amount: Paise }[] } | null, 'budgets');
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);
  // useLedger reloads on focus and on ledger changes; a different month needs a reload too.
  useEffect(() => {
    reload();
  }, [month, reload]);
  if (!data) return null;
  const { overview, income } = data;

  const roots = overview.lines.filter((l) => !l.category!.parentId);
  const children = (id: string) => sortBudgets(overview.lines.filter((l) => l.category!.parentId === id), sort, sortable);
  // A category budgeted through its sub-categories sorts by their budgets added up and their worst status.
  const rootNumbers = (l: BudgetLine): SortableBudget => {
    const subs = children(l.category!.id);
    return subs.some((c) => c.limit !== null) ? combineBudgets(l.category!.name, l.spent, subs.map(sortable)) : sortable(l);
  };
  const active = (l: BudgetLine) => l.limit !== null || l.spent !== 0;
  const shown = sortBudgets(roots, sort, rootNumbers).filter((l) => active(l) || children(l.category!.id).some(active) || (showAll && !l.category!.system));
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

  const toggle = (id: string) => setToggled((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {error && <ErrorText>{error}</ErrorText>}
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
              <Text style={[styles.sectionTitle, styles.grow]}>Categories</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Change the order" hitSlop={8} onPress={() => setSorting(true)} style={styles.sortButton}>
                <Text style={styles.sortText}>{BUDGET_SORTS.find((s) => s.key === sort)!.label}</Text>
                <Feather name="chevron-down" size={14} color={colors.muted} />
              </Pressable>
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
                sub={children(line.category!.id)}
                elapsed={overview.elapsed}
                childBudgets={children(line.category!.id).some((c) => c.limit !== null)}
                open={children(line.category!.id).some((c) => c.limit !== null) !== toggled.has(line.category!.id)}
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
      <Sheet visible={sorting} onClose={() => setSorting(false)} title="Order categories by">
        {BUDGET_SORTS.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: sort === option.key }}
            onPress={() => {
              setSort(option.key);
              setSorting(false);
            }}
            style={({ pressed }) => [styles.sortOption, pressed && styles.pressed]}
          >
            <Text style={styles.sortOptionText}>{option.label}</Text>
            {sort === option.key && <Feather name="check" size={18} color={colors.primary} />}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

/**
 * BUD-2: what is left divided by the days left, today included. Only for this
 * month while under budget. Whole paise, rounded down so it never overstates.
 */
function perDay(line: BudgetLine, month: MonthKey): Paise | null {
  const days = daysLeft(month);
  if (days === null || line.limit === null || line.spent >= line.limit) return null;
  return paise(Math.floor((line.limit - line.spent) / days));
}

/** BUD-1 and BUD-2 on the money card: the total budget, its pace and what's left a day (decision 0015). */
function Overall({ line, outside, month, elapsed }: { line: BudgetLine; outside: Paise; month: MonthKey; elapsed: number }) {
  const days = daysLeft(month);
  const status = line.pace?.status ?? 'ok';
  const budgeted = line.limit !== null;
  const daily = perDay(line, month);
  const left = budgeted ? line.limit! - line.spent : 0;
  const pill = status === 'over' ? 'Over budget' : status === 'pace' ? 'Spending fast' : 'On track';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(budgetHref('overall', month))} style={({ pressed }) => pressed && styles.pressed}>
      <MoneyCard style={styles.overall}>
        <View style={styles.row}>
          <Text style={[styles.heroMuted, styles.grow]}>{budgeted ? 'Spent in your budgets' : 'All spending'}</Text>
          {budgeted && <Text style={[styles.pill, status === 'ok' ? styles.pillOk : styles.pillWarn]}>{pill}</Text>}
        </View>
        <View style={styles.big}>
          <Text style={[styles.bigAmount, status === 'over' && { color: colors.heroDanger }]}>{rupees(line.spent)}</Text>
          {budgeted && <Text style={styles.heroMuted}>of {rupees(line.limit!)}</Text>}
        </View>
        {budgeted && <ProgressBar value={line.spent / line.limit!} status={status} marker={elapsed} onHero />}
        {budgeted && (
          <View style={styles.row}>
            <Text style={[styles.heroMuted, styles.grow]}>
              {status === 'over'
                ? `Over by ${rupees(-left)}`
                : status === 'pace'
                  ? `On pace for ${rupees(line.pace!.projected)}`
                  : `${rupees(left)} left`}
              {days !== null ? ` · ${days === 1 ? 'last day' : `${days} days`}` : ''}
            </Text>
            {daily !== null && <Text style={styles.heroDaily}>≈ {rupees(daily)} a day</Text>}
          </View>
        )}
        {!budgeted ? (
          <Text style={styles.heroMuted}>Set budgets on the categories you want to track. Your total budget is their sum.</Text>
        ) : (
          outside > 0 && <Text style={styles.heroMuted}>{rupees(outside)} spent outside your budgets</Text>
        )}
      </MoneyCard>
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

/** "Over by", "On pace for", and while under budget this month, what's left a day (BUD-2). */
function PaceNote({ line, month }: { line: BudgetLine; month: MonthKey }) {
  const daily = perDay(line, month);
  const note =
    line.pace?.status === 'over' ? (
      <Text style={styles.over}>Over by {rupees(line.spent - line.limit!)}</Text>
    ) : line.pace?.status === 'pace' ? (
      <Text style={styles.warn}>On pace for {rupees(line.pace.projected)}</Text>
    ) : null;
  if (!note && daily === null) return null;
  return (
    <View style={styles.paceRow}>
      <View style={styles.grow}>{note}</View>
      {daily !== null && <Text style={styles.daily}>{rupees(daily)} a day</Text>}
    </View>
  );
}

function CategoryCard(props: { line: BudgetLine; month: MonthKey; sub: BudgetLine[]; elapsed: number; childBudgets: boolean; open: boolean; onToggle: () => void; onSet: () => void }) {
  const { line, month, sub } = props;
  const category = line.category!;
  const style = categoryStyle(category);
  const status = line.pace?.status ?? 'ok';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(budgetHref(category.id, month))} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.row}>
        <CategoryIcon category={category} />
        <Text style={[styles.name, styles.grow]} numberOfLines={1}>
          {category.name}
        </Text>
        <Text style={[styles.amount, status === 'over' && { color: colors.danger }]}>
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
      {line.limit !== null && <ProgressBar value={line.spent / line.limit} status={status} color={style.color} marker={props.elapsed} />}
      <PaceNote line={line} month={month} />
      {props.childBudgets && <Text style={styles.meta}>Budgets are on its sub-categories</Text>}
      {props.open && (
        <View style={styles.children}>
          {sub.map((child) => (
            <Pressable
              key={child.category!.id}
              accessibilityRole="button"
              onPress={() => router.push(budgetHref(child.category!.id, month))}
              style={({ pressed }) => [styles.childItem, pressed && styles.pressed]}
            >
              <View style={styles.child}>
                <Text style={[styles.childText, styles.grow]} numberOfLines={1}>
                  {child.category!.name}
                </Text>
                <Text style={[styles.childText, child.pace?.status === 'over' && { color: colors.danger }]}>
                  {rupees(child.spent)}
                  {child.limit !== null ? ` of ${rupees(child.limit)}` : ''}
                </Text>
              </View>
              {child.limit !== null && (
                <ProgressBar value={child.spent / child.limit} status={child.pace?.status ?? 'ok'} color={style.color} marker={props.elapsed} />
              )}
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
      <MoneyCard style={styles.overall}>
        <Text style={styles.heroMuted}>Money in</Text>
        <Text style={[styles.bigAmount, total > 0 && { color: colors.heroAccent }]}>{rupees(total)}</Text>
      </MoneyCard>
      {income.length === 0 && <Text style={styles.meta}>No income this month yet.</Text>}
      {income.map(({ category, amount }) => (
        <Pressable
          key={category.id}
          accessibilityRole="button"
          onPress={() => router.push(budgetHref(category.id, month))}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.row}>
            <CategoryIcon category={category} />
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
  container: { paddingHorizontal: 16, paddingBottom: 48, gap: 10 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  month: { fontSize: 16, fontWeight: '600', color: colors.text, minWidth: 120, textAlign: 'center' },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  overall: { gap: 10, paddingVertical: 18 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  bigAmount: { fontSize: 32, fontWeight: '700', color: colors.heroText, letterSpacing: -0.5, ...figures },
  heroMuted: { fontSize: 13, color: colors.heroMuted, lineHeight: 19, ...figures },
  heroDaily: { fontSize: 13, fontWeight: '600', color: colors.heroText, ...figures },
  pill: { fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  pillOk: { color: colors.heroAccent, backgroundColor: colors.heroPill },
  pillWarn: { color: colors.heroWarning, backgroundColor: 'rgba(240,163,94,0.16)' },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  daily: { fontSize: 12, color: colors.muted, ...figures },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginTop: 6 },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  sortOption: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 4 },
  sortOptionText: { flex: 1, fontSize: 15, color: colors.text },
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
  childItem: { gap: 6, paddingBottom: 6 },
  child: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  childText: { fontSize: 13, color: colors.secondary, fontVariant: ['tabular-nums'] },
  warn: { fontSize: 12, fontWeight: '500', color: colors.warning },
  over: { fontSize: 12, fontWeight: '500', color: colors.danger },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: 8 },
});
