import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, daysInMonth, paise, standout, type MonthKey, type Paise } from '@money-plant/core';
import { askToReplaceBudgets } from '@/components/budget-overlap';
import { BudgetSheet } from '@/components/budget-sheet';
import { categoryStyle } from '@/components/category-style';
import { formatDate, formatDay, formatMonth, formatAmount as rupees } from '@/components/format';
import { LineChart } from '@/components/line-chart';
import { CategoryIcon } from '@/components/sheet';
import { Chip, Initial, SectionTitle, radius, useColors, makeStyles, MoneyCard } from '@/components/ui';
import {
  carryText,
  categoryBreakdown,
  changeOverspend,
  currentMonth,
  daysLeft,
  monthOverview,
  setBudget,
  spreadText,
  stopOverspend,
  type BudgetEntry,
  type BudgetLine,
  type CategoryBreakdown,
  type OverspendDebt,
} from '@/lib/budgets';
import { SpreadSheet } from '@/components/spread-sheet';
import { categoryNames, flatten, listCategories, type CategoryNode } from '@/lib/categories';
import { requestNotificationPermission } from '@/lib/notifications';
import { useLedger } from '@/lib/use-ledger';

interface Data {
  month: MonthKey;
  category: CategoryNode | null;
  line: BudgetLine | null;
  detail: CategoryBreakdown;
  names: Map<string, string>;
  /** Spent outside budgets this month, for the total. */
  outside: Paise;
  /** How much of the month has passed, for the pace marker. */
  elapsed: number;
  parentName: string | null;
}

async function load(id: string, month: MonthKey): Promise<Data> {
  const categoryId = id === 'overall' ? null : id;
  const [overview, detail, names, tree] = await Promise.all([monthOverview(month), categoryBreakdown(month, categoryId, { page: true }), categoryNames(), listCategories()]);
  const category = categoryId === null ? null : (flatten(tree).find((c) => c.id === categoryId) ?? null);
  const line = categoryId === null ? overview.overall : (overview.lines.find((l) => l.category?.id === categoryId) ?? null);
  const parentName = category?.parentId ? (names.get(category.parentId) ?? null) : null;
  return { month, category, line, detail, names, outside: overview.outside, elapsed: overview.elapsed, parentName };
}

/** Places shown before "Show all", and as filters. */
const TOP = 5;

type Tab = 'entries' | 'insights';
type Order = 'date' | 'place' | 'biggest';
type Filter = { kind: 'place' | 'category' | 'account'; id: string } | null;

const shortMonth = (month: MonthKey) => formatMonth(month).slice(0, 3);
const monthName = (month: MonthKey) => formatMonth(month).split(' ')[0]!;
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** What's left a day while under budget this month, today included (decision 0015). */
function perDay(line: BudgetLine | null, month: MonthKey): Paise | null {
  const days = daysLeft(month);
  if (days === null || !line || line.limit === null || line.spent >= line.limit) return null;
  return paise(Math.floor((line.limit - line.spent) / days));
}

/**
 * BUD-1 and BUD-3 (decision 0038): one budget for a month. The money card
 * shows spending against an even pace; then two tabs. Entries lists every
 * entry that counts here, by day, by place or biggest first, with filters.
 * Insights has what's safe to spend, where the month ends, the entry that
 * stands out, last month by the same day, 6 months, the split by
 * sub-category and place, payments still due, carry-over and the budget
 * itself. Income categories show what came in, with no budget.
 */
export default function CategoryMonth() {
  const colors = useColors();
  const styles = useStyles();
  const params = useLocalSearchParams<{ id: string; month?: string }>();
  // The month asked for; the screen draws the month its data was loaded for, so
  // stepping months never mixes one month's numbers with another's length.
  const wanted = (params.month ?? currentMonth()) as MonthKey;
  const { data, reload } = useLedger(() => load(params.id, wanted), null as Data | null);
  const [editing, setEditing] = useState<'default' | 'month' | null>(null);
  const [start, setStart] = useState<Paise | null>(null);
  const [tab, setTab] = useState<Tab>('entries');
  const [order, setOrder] = useState<Order>('date');
  const [filter, setFilter] = useState<Filter>(null);
  const [allPlaces, setAllPlaces] = useState(false);

  useEffect(() => {
    if (data && data.month !== wanted) {
      setFilter(null);
      void reload();
    }
  }, [wanted, data, reload]);

  const entries = data?.detail.entries ?? [];
  const shown = useMemo(
    () =>
      entries.filter(
        (e) =>
          !filter ||
          (filter.kind === 'place' && e.place.key === filter.id) ||
          (filter.kind === 'category' && e.categoryId === filter.id) ||
          (filter.kind === 'account' && e.account?.id === filter.id),
      ),
    [entries, filter],
  );
  const places = useMemo(() => groupBy(entries, (e) => e.place.key, (e) => e.place.name), [entries]);
  const accounts = useMemo(() => groupBy(entries.filter((e) => e.account), (e) => e.account!.id, (e) => e.account!.name), [entries]);

  if (!data) return null;

  const { month, category, line, detail, names } = data;
  const overall = params.id === 'overall';
  const categoryId = overall ? null : params.id;
  const income = category?.flow === 'income';
  const title = overall ? 'All spending' : (category?.name ?? 'Category');
  const style = categoryStyle(category);
  const setting = line?.setting ?? { default: null, override: null, limit: null };
  const left = daysLeft(month);
  const current = month === currentMonth();
  const limit = !income && line?.limit != null ? line.limit : null;
  const daily = perDay(line, month);
  const stands = standout(detail.entries.map((e) => ({ ...e, counterparty: e.payee })));
  const total = overall && limit !== null ? line!.spent : detail.total;
  const evenNow = limit !== null && current ? Math.round((limit * new Date().getDate()) / daysInMonth(month)) : null;
  const projected = limit !== null && current && line?.pace ? line.pace.projected : null;
  const categoryName = (id: string) => names.get(id) ?? 'Category';
  const lastMonth = addMonths(month, -1);

  async function edit(target: 'default' | 'month') {
    const { proceed, start: from } = await askToReplaceBudgets(categoryId!, title);
    if (!proceed) return;
    setStart(from);
    setEditing(target);
  }

  async function save(target: 'default' | 'month', value: Paise | null) {
    setEditing(null);
    await setBudget(target === 'default' ? null : month, categoryId!, value);
    if (value !== null) await requestNotificationPermission();
  }

  const goMonth = (n: number) => router.setParams({ month: addMonths(month, n) });

  // Up to three one-line insights on top; each opens the Insights tab.
  const notes: { text: string; warn?: boolean }[] = [];
  if (evenNow !== null && total !== evenNow) {
    notes.push(total > evenNow ? { text: `${rupees(total - evenNow)} over even pace`, warn: true } : { text: `${rupees(evenNow - total)} under even pace` });
  }
  if (stands) notes.push({ text: `One entry is ${percent(stands.share)} of it` });
  if (detail.lastMonthByNow !== null && detail.lastMonthByNow > 0) {
    const diff = total - detail.lastMonthByNow;
    if (diff !== 0) notes.push({ text: `${rupees(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${monthName(lastMonth)} by now` });
  }

  const tree = detail.byCategory.length > 1;
  const metaFor = (e: BudgetEntry, withDate: boolean) =>
    [
      e.note ? e.place.name : e.payee && e.payee !== e.place.name ? e.payee : null,
      tree ? categoryName(e.categoryId) : null,
      e.account?.name ?? null,
      withDate ? formatDate(e.occurredAt) : null,
    ]
      .filter(Boolean)
      .join(' · ');

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
          <CategoryIcon category={category} size={48} />
        )}
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.meta}>
            {formatMonth(month)}
            {left !== null ? ` · ${left === 1 ? 'last day' : `${left} days left`}` : ''}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={4} onPress={() => goMonth(-1)} style={styles.arrow}>
          <Feather name="chevron-left" size={18} color={colors.secondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: current }}
          disabled={current}
          hitSlop={4}
          onPress={() => goMonth(1)}
          style={styles.arrow}
        >
          <Feather name="chevron-right" size={18} color={current ? colors.placeholder : colors.secondary} />
        </Pressable>
      </View>

      <MoneyCard>
        <Text style={styles.heroText}>
          <Text style={[styles.heroBig, line?.pace?.status === 'over' && limit !== null && { color: colors.heroDanger }]}>{rupees(total)}</Text>
          {limit !== null ? <Text style={styles.heroMeta}> of {rupees(limit)}</Text> : <Text style={styles.heroMeta}>{income ? ' came in' : ' this month'}</Text>}
        </Text>
        {limit !== null && <PaceChart running={detail.running} limit={limit} month={month} projected={projected} status={line?.pace?.status ?? 'ok'} />}
        {limit !== null && <Text style={styles.heroMeta}>{paceText(line!, left, daily)}</Text>}
        {line && carryText(line, month) !== null && <Text style={styles.heroMeta}>{carryText(line, month)}.</Text>}
      </MoneyCard>

      {notes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.noteRow}>
          {notes.map((n) => (
            <Pressable key={n.text} accessibilityRole="button" onPress={() => setTab('insights')} style={[styles.note, n.warn && styles.noteWarn]}>
              <Text style={[styles.noteText, n.warn && styles.noteTextWarn]}>{n.text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View accessibilityRole="tablist" style={styles.tabs}>
        {(['entries', 'insights'] as const).map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'entries' ? `Entries · ${entries.length}` : 'Insights'}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'entries' ? (
        <>
          {entries.length === 0 ? (
            <Text style={styles.empty}>No entries {income ? 'came in' : 'counted here'} in {formatMonth(month)}.</Text>
          ) : (
            <>
              <View style={styles.pills}>
                {(
                  [
                    ['date', 'By date'],
                    ['place', 'By place'],
                    ['biggest', 'Biggest'],
                  ] as const
                ).map(([key, label]) => (
                  <Chip key={key} label={label} selected={order === key} onPress={() => setOrder(key)} />
                ))}
              </View>
              {(places.length > 1 || tree || accounts.length > 1) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  <Chip label="All" selected={filter === null} onPress={() => setFilter(null)} />
                  {places.length > 1 &&
                    places.slice(0, TOP).map((p) => (
                      <Chip key={`p${p.key}`} label={`${p.name} · ${p.count}`} selected={filter?.kind === 'place' && filter.id === p.key} onPress={() => setFilter({ kind: 'place', id: p.key })} />
                    ))}
                  {tree &&
                    detail.byCategory.map((c) => (
                      <Chip
                        key={`c${c.categoryId}`}
                        label={categoryName(c.categoryId)}
                        selected={filter?.kind === 'category' && filter.id === c.categoryId}
                        onPress={() => setFilter({ kind: 'category', id: c.categoryId })}
                      />
                    ))}
                  {accounts.length > 1 &&
                    accounts.map((a) => (
                      <Chip key={`a${a.key}`} label={a.name} selected={filter?.kind === 'account' && filter.id === a.key} onPress={() => setFilter({ kind: 'account', id: a.key })} />
                    ))}
                </ScrollView>
              )}
              {filter && (
                <Text style={styles.meta}>
                  {shown.length} {shown.length === 1 ? 'entry' : 'entries'} · {rupees(shown.reduce((sum, e) => sum + e.amount, 0))}
                </Text>
              )}
              {order === 'date' &&
                groupBy(shown, (e) => formatDay(e.occurredAt), (e) => formatDay(e.occurredAt), false).map((day) => (
                  <View key={day.key}>
                    <View style={styles.dayHead}>
                      <Text style={styles.dayText}>{day.name}</Text>
                      <Text style={styles.dayText}>{rupees(day.amount)}</Text>
                    </View>
                    <View style={styles.panel}>
                      {day.items.map((e, i) => (
                        <EntryRow key={e.key} entry={e} meta={metaFor(e, false)} divided={i > 0} />
                      ))}
                    </View>
                  </View>
                ))}
              {order === 'place' &&
                groupBy(shown, (e) => e.place.key, (e) => e.place.name).map((p) => (
                  <View key={p.key} style={styles.panel}>
                    <View style={styles.placeHead}>
                      <Initial name={p.name} size={36} />
                      <View style={styles.grow}>
                        <View style={styles.between}>
                          <Text style={styles.name} numberOfLines={1}>
                            {p.name}
                          </Text>
                          <Text style={styles.amount}>{rupees(p.amount)}</Text>
                        </View>
                        <Text style={styles.note2}>
                          {p.count} {p.count === 1 ? 'entry' : 'entries'}
                          {detail.total > 0 ? ` · ${percent(p.amount / detail.total)}` : ''}
                        </Text>
                      </View>
                    </View>
                    {p.items.map((e) => (
                      <EntryRow key={e.key} entry={e} meta={metaFor(e, true)} divided compact />
                    ))}
                  </View>
                ))}
              {order === 'biggest' && (
                <View style={styles.panel}>
                  {[...shown]
                    .sort((a, b) => b.amount - a.amount)
                    .map((e, i) => (
                      <EntryRow key={e.key} entry={e} meta={metaFor(e, true)} divided={i > 0} />
                    ))}
                </View>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <View style={styles.tiles}>
            {daily !== null && <Tile label="Safe to spend" value={`${rupees(daily)} a day`} note={`${rupees(limit! - line!.spent)} for ${left} ${left === 1 ? 'day' : 'days'}`} />}
            {projected !== null && (
              <Tile
                label="At this pace"
                value={`Ends near ${rupees(projected)}`}
                note={projected > limit! ? `${rupees(projected - limit!)} over` : `${rupees(limit! - projected)} to spare`}
                warn={projected > limit!}
              />
            )}
            {stands && <Tile label="Biggest entry" value={`${percent(stands.share)} of it`} note={`Without it: ${rupees(stands.without)}`} onPress={() => router.push(`/transaction/${stands.item.transactionId}`)} />}
            {detail.lastMonthByNow !== null && (
              <Tile
                label={`By ${new Date().getDate()} ${shortMonth(lastMonth)}`}
                value={rupees(detail.lastMonthByNow)}
                note={
                  detail.lastMonthByNow === 0
                    ? `Nothing ${income ? 'came in' : 'spent'} by then`
                    : `${rupees(Math.abs(total - detail.lastMonthByNow))} ${total >= detail.lastMonthByNow ? 'more' : 'less'} now`
                }
              />
            )}
          </View>

          <SectionTitle>Last 6 months</SectionTitle>
          <History history={detail.history} color={overall ? colors.primary : style.color} />
          <Text style={styles.meta}>
            {detail.previousAverage > 0
              ? `The 3 months before averaged ${rupees(detail.previousAverage)}. ${
                  detail.total >= detail.previousAverage
                    ? `This month is ${rupees(detail.total - detail.previousAverage)} more.`
                    : `This month is ${rupees(detail.previousAverage - detail.total)} less.`
                }`
              : `Nothing ${income ? 'came in' : 'spent'} here in the 3 months before.`}
          </Text>

          {detail.total > 0 && (
            <>
              <SectionTitle>Where it went</SectionTitle>
              <View style={[styles.panel, styles.padded]}>
                {tree && (
                  <>
                    <View style={styles.stack}>
                      {detail.byCategory
                        .filter((c) => c.amount > 0)
                        .map((c, i) => (
                          <View key={c.categoryId} style={{ flex: c.amount, backgroundColor: SPLIT[i % SPLIT.length]!(colors, style.color) }} />
                        ))}
                    </View>
                    {detail.byCategory.map((c, i) => (
                      <Pressable key={c.categoryId} accessibilityRole="button" onPress={() => router.push(`/budget/${c.categoryId}?month=${month}`)} style={styles.splitRow}>
                        <View style={[styles.dot, { backgroundColor: SPLIT[i % SPLIT.length]!(colors, style.color) }]} />
                        <Text style={[styles.label, styles.grow]} numberOfLines={1}>
                          {categoryName(c.categoryId)}
                        </Text>
                        <Text style={styles.rowAmount}>
                          {rupees(c.amount)} · {percent(c.amount / detail.total)}
                        </Text>
                      </Pressable>
                    ))}
                    <View style={styles.rule} />
                  </>
                )}
                {(allPlaces ? places : places.slice(0, TOP)).map((p) => (
                  <Pressable
                    key={p.key}
                    accessibilityRole="button"
                    onPress={() => {
                      setFilter({ kind: 'place', id: p.key });
                      setOrder('date');
                      setTab('entries');
                    }}
                    style={styles.placeRow}
                  >
                    <View style={styles.between}>
                      <Text style={[styles.label, styles.grow]} numberOfLines={1}>
                        {p.name} · {p.count}×
                      </Text>
                      <Text style={styles.rowAmount}>{rupees(p.amount)}</Text>
                    </View>
                    <View style={styles.shareTrack}>
                      <View style={[styles.shareFill, { width: `${Math.max(2, Math.min(100, (p.amount / detail.total) * 100))}%`, backgroundColor: overall ? colors.primary : style.color }]} />
                    </View>
                  </Pressable>
                ))}
                {!allPlaces && places.length > TOP && (
                  <Pressable accessibilityRole="button" onPress={() => setAllPlaces(true)} style={styles.more}>
                    <Text style={styles.link}>Show all {places.length} places</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}

          {!income && current && (
            <>
              <SectionTitle>Still to come this month</SectionTitle>
              {detail.stillDue.length === 0 ? (
                <Text style={styles.meta}>No recurring payments here are due before {formatDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString())}.</Text>
              ) : (
                <View style={styles.panel}>
                  {detail.stillDue.map((r, i) => (
                    <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push(`/recurring/${r.id}`)} style={[styles.budgetRow, i > 0 && styles.divided]}>
                      <View style={styles.grow}>
                        <Text style={styles.name}>{r.name}</Text>
                        <Text style={styles.note2}>Due {formatDate(`${r.due}T12:00:00`)}</Text>
                      </View>
                      <Text style={styles.amount}>{rupees(r.amount, r.currency)}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          {!overall && current && line && line.overspends.some((d) => d.left > 0) && (
            <>
              <SectionTitle>Overspends coming off</SectionTitle>
              {line.overspends
                .filter((d) => d.left > 0)
                .map((d) => (
                  <OverspendRow key={d.id} debt={d} />
                ))}
            </>
          )}

          {overall && (
            <Text style={styles.meta}>
              {line?.limit != null
                ? `Your total budget is the sum of your category budgets.${(data.outside ?? 0) > 0 ? ` ${rupees(data.outside)} went to categories without one.` : ''}`
                : 'Set budgets on the categories you want to track. Your total budget is their sum.'}
            </Text>
          )}

          {!income && !overall && (
            <>
              <SectionTitle>Budget</SectionTitle>
              {line?.inParentBudget && (
                <Text style={styles.meta}>Counted in {data.parentName}'s budget. A budget here replaces {data.parentName}'s, so you can budget each sub-category.</Text>
              )}
              <View style={styles.panel}>
                <BudgetRow
                  title="Every month"
                  note={setting.default === null ? 'No budget yet. It applies to every month unless you change one' : 'Applies to every month unless you change one'}
                  amount={setting.default}
                  onPress={() => edit('default')}
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
                  onPress={() => edit('month')}
                />
              </View>
              {line && carryText(line, month) === null && current && <Text style={styles.meta}>What's left at the month's end can carry into {monthName(addMonths(month, 1))} from the month review.</Text>}
            </>
          )}
        </>
      )}

      <BudgetSheet
        visible={editing === 'default'}
        title={`${title}: every month`}
        note="Applies to every month unless you change one."
        value={setting.default ?? start}
        removeLabel={setting.default !== null ? 'Remove budget' : undefined}
        onSave={(value) => save('default', value)}
        onClose={() => setEditing(null)}
      />
      <BudgetSheet
        visible={editing === 'month'}
        title={`${title}: ${monthName(month)} only`}
        note={setting.default !== null ? `Other months stay at ${rupees(setting.default)}.` : 'Other months stay without a budget.'}
        value={setting.override ?? setting.default ?? start}
        removeLabel={setting.override !== null ? (setting.default !== null ? `Reset to ${rupees(setting.default)}` : 'Remove for this month') : undefined}
        onSave={(value) => save('month', value)}
        onClose={() => setEditing(null)}
      />
    </ScrollView>
  );
}

/** Colours for the sub-category split: the category's own first, then the app's neutrals. */
const SPLIT: ((colors: ReturnType<typeof useColors>, own: string) => string)[] = [
  (_, own) => own,
  (c) => c.primary,
  (c) => c.warning,
  (c) => c.secondary,
  (c) => c.muted,
  (c) => c.placeholder,
];

/** Groups entries by a key, largest total first, or in the entries' own order (newest first). */
function groupBy(entries: readonly BudgetEntry[], keyOf: (e: BudgetEntry) => string, nameOf: (e: BudgetEntry) => string, biggestFirst = true) {
  const groups = new Map<string, { key: string; name: string; amount: number; count: number; items: BudgetEntry[] }>();
  for (const e of entries) {
    const key = keyOf(e);
    const group = groups.get(key) ?? { key, name: nameOf(e), amount: 0, count: 0, items: [] };
    group.amount += e.amount;
    group.count += 1;
    group.items.push(e);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  return biggestFirst ? list.sort((a, b) => b.amount - a.amount) : list;
}

/**
 * BUD-2 and BUD-3 (decision 0038): spending through the month as a line,
 * against an even pace to the budget, with where today's pace ends dotted on.
 */
function PaceChart(props: { running: Paise[]; limit: Paise; month: MonthKey; projected: Paise | null; status: 'ok' | 'pace' | 'over' }) {
  const colors = useColors();
  const styles = useStyles();
  const days = daysInMonth(props.month);
  const running = props.running.slice(0, days);
  const today = running.length;
  const color = props.status === 'over' ? colors.heroDanger : props.status === 'pace' ? colors.heroWarning : colors.heroAccent;
  // Point 0 is the start of the 1st; point d is the end of day d.
  const spent = [0, ...running, ...Array.from({ length: days - today }, () => null)];
  const even = Array.from({ length: days + 1 }, (_, d) => Math.round((props.limit * d) / days));
  const budget = Array.from({ length: days + 1 }, () => props.limit);
  const end = props.projected;
  const last = running.at(-1) ?? 0;
  const ahead =
    end !== null && today < days
      ? Array.from({ length: days + 1 }, (_, d) => (d < today ? null : Math.round(last + ((end - last) * (d - today)) / (days - today))))
      : [];
  return (
    <View style={styles.chartBox}>
      <LineChart
        height={96}
        label={`Spent ${rupees(last)} by day ${today} of ${days}, against an even pace to ${rupees(props.limit)}`}
        series={[
          { values: budget, color: `${colors.heroMuted}55`, thickness: 1 },
          { values: even, color: `${colors.heroMuted}99`, thickness: 1.5 },
          ...(ahead.length ? [{ values: ahead, color: `${color}88`, thickness: 2 }] : []),
          { values: spent, color, thickness: 2.5 },
        ]}
      />
      <View style={styles.legend}>
        <Legend color={color} label="You" />
        <Legend color={`${colors.heroMuted}99`} label="Even pace" />
        <Legend color={`${colors.heroMuted}55`} label="Budget" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendLine, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Tile(props: { label: string; value: string; note: string; warn?: boolean; onPress?: () => void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole={props.onPress ? 'button' : undefined} disabled={!props.onPress} onPress={props.onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <Text style={styles.note2}>{props.label}</Text>
      <Text style={[styles.tileValue, props.warn && styles.warnText]} numberOfLines={2}>
        {props.value}
      </Text>
      <Text style={styles.note2}>{props.note}</Text>
    </Pressable>
  );
}

/** One entry, named by its place (BUD-3), with the payee as the bank wrote it underneath when that differs. */
function EntryRow({ entry, meta, divided, compact }: { entry: BudgetEntry; meta: string; divided?: boolean; compact?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/transaction/${entry.transactionId}`)}
      style={({ pressed }) => [styles.entry, compact && styles.entryCompact, divided && styles.divided, pressed && styles.pressed]}
    >
      {!compact && <Initial name={entry.place.name} size={36} />}
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.note ?? entry.place.name}
        </Text>
        {meta !== '' && (
          <Text style={styles.note2} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      <Text style={[styles.amount, entry.amount < 0 && styles.refund]}>{entry.amount < 0 ? `+${rupees(-entry.amount)}` : rupees(entry.amount)}</Text>
    </Pressable>
  );
}

/**
 * BUD-5 (decision 0034): an overspend still to come off later budgets, with
 * Change (as needed, or spread over 2 to 6 months) and Stop carrying the rest.
 * Both apply from next month; what already came off stays as it was.
 */
function OverspendRow({ debt }: { debt: OverspendDebt }) {
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  const stop = () =>
    Alert.alert('Stop carrying the rest?', `${rupees(debt.left)} of ${monthName(debt.from)}'s overspend won't come off any later budget. What already came off stays as it was.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => void stopOverspend(debt) },
    ]);
  return (
    <View style={styles.panel}>
      <View style={styles.budgetRow}>
        <View style={styles.grow}>
          <Text style={styles.name}>{rupees(debt.left)} still to come off</Text>
          <Text style={styles.note2}>
            From {monthName(debt.from)}'s overspend, {spreadText(debt.spread)}
            {debt.clearsBy ? `, through ${monthName(debt.clearsBy)}` : ', once a month has a budget for it'}.
          </Text>
        </View>
      </View>
      <View style={[styles.budgetRow, styles.divided, styles.actions]}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPicking(true)}>
          <Text style={styles.link}>Change</Text>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={stop}>
          <Text style={styles.link}>Stop carrying the rest</Text>
        </Pressable>
      </View>
      <SpreadSheet
        visible={picking}
        amount={debt.left}
        value={debt.spread}
        onPick={(spread) => {
          setPicking(false);
          void changeOverspend(debt, spread);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

function paceText(line: BudgetLine, left: number | null, daily: Paise | null): string {
  const limit = line.limit!;
  if (line.spent > limit) return `Over by ${rupees(line.spent - limit)}.`;
  const remaining = `${rupees(limit - line.spent)} left${left !== null ? ` for ${left} ${left === 1 ? 'day' : 'days'}` : ''}`;
  const perDay = daily !== null ? `, about ${rupees(daily)} a day` : '';
  const pace = line.pace && left !== null ? ` At this pace the month ends near ${rupees(line.pace.projected)}.` : '';
  return `${remaining}${perDay}.${pace}`;
}

function BudgetRow(props: { title: string; note: string; amount: Paise | null; divided?: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.budgetRow, props.divided && styles.divided, pressed && styles.pressed]}>
      <View style={styles.grow}>
        <Text style={styles.name}>{props.title}</Text>
        <Text style={styles.note2}>{props.note}</Text>
      </View>
      {props.amount !== null ? <Text style={styles.amount}>{rupees(props.amount)}</Text> : <Text style={styles.link}>Set</Text>}
    </Pressable>
  );
}

/** Six bars, oldest first, the last one in the category's colour. */
function History({ history, color }: { history: { month: MonthKey; total: Paise }[]; color: string }) {
  const colors = useColors();
  const styles = useStyles();
  const max = Math.max(1, ...history.map((h) => h.total));
  return (
    <View style={styles.chart} accessible accessibilityLabel={history.map((h) => `${formatMonth(h.month)} ${rupees(h.total)}`).join(', ')}>
      {history.map((h, i) => {
        const current = i === history.length - 1;
        return (
          <View key={h.month} style={styles.column}>
            <Text style={[styles.barLabel, current && { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {h.total > 0 ? rupees(h.total) : ''}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: `${Math.max(2, (Math.max(0, h.total) / max) * 100)}%`, backgroundColor: current ? color : colors.track }]} />
            </View>
            <Text style={[styles.barMonth, current && { color: colors.text }]}>{shortMonth(h.month)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  heroBig: { fontSize: 32, fontWeight: '700', color: colors.heroText, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroMeta: { fontSize: 13, color: colors.heroMuted, lineHeight: 19 },
  heroText: { color: colors.heroText },
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  overallIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  arrow: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  empty: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  chartBox: { gap: 6 },
  legend: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 14, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.heroMuted },
  noteRow: { gap: 8 },
  note: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.subtle },
  noteWarn: { backgroundColor: colors.warningSurface },
  noteText: { fontSize: 12, color: colors.secondary },
  noteTextWarn: { color: colors.warning, fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: 4, padding: 4, marginTop: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.subtle },
  tabText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  tabTextOn: { color: colors.text, fontWeight: '600' },
  pills: { flexDirection: 'row', gap: 8 },
  filters: { gap: 8 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 6 },
  dayText: { fontSize: 12, color: colors.muted, fontVariant: ['tabular-nums'] },
  panel: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  padded: { padding: 16, gap: 10 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  entryCompact: { paddingLeft: 62, minHeight: 52 },
  placeHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  refund: { color: colors.primary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, padding: 14, gap: 4, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tileValue: { fontSize: 17, fontWeight: '700', color: colors.text },
  warnText: { color: colors.warning },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  placeRow: { gap: 6, paddingVertical: 4 },
  shareTrack: { height: 4, borderRadius: 2, backgroundColor: colors.track },
  shareFill: { height: 4, borderRadius: 2 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  actions: { minHeight: 48, gap: 24 },
  pressed: { backgroundColor: colors.pressed },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  note2: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chart: { flexDirection: 'row', gap: 8, height: 140, paddingHorizontal: 4 },
  column: { flex: 1, alignItems: 'center', gap: 6 },
  barLabel: { fontSize: 10, color: colors.muted, fontVariant: ['tabular-nums'] },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
  barMonth: { fontSize: 12, color: colors.muted },
  label: { fontSize: 14, color: colors.text },
  rowAmount: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
}));
