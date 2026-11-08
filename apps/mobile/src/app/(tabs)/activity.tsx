import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, currencyInfo, dateOf, monthOf, type MonthKey } from '@money-plant/core';
import { FilterSheet, NO_FILTERS, activeChips, passes, type ActivityFilters } from '@/components/activity-filters';
import { formatAmount, formatDay, formatMonth, formatWholeRupees } from '@/components/format';
import { transactionTitle, TransactionItem } from '@/components/transaction-item';
import { ErrorText, colors, figures, radius } from '@/components/ui';
import { useAiWaiting } from '@/lib/ai-settings';
import { flatten, listCategories } from '@/lib/categories';
import { homeCurrency } from '@/lib/home-currency';
import { listTransactions, type TransactionRow } from '@/lib/ledger';
import { usePullToRefresh } from '@/lib/refresh';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const [rows, tree] = await Promise.all([listTransactions(), listCategories()]);
  return { rows, parents: new Map(flatten(tree).map((c) => [c.id, c.parentId])) };
}

function matchesQuery(row: TransactionRow, query: string): boolean {
  if (!query) return true;
  const leg = row.legs[0];
  const amount = Math.abs(leg?.amount ?? 0);
  const currency = leg?.currency ?? homeCurrency();
  const haystack = [transactionTitle(row), row.category?.name ?? '', row.tx.note ?? '', String(amount / 10 ** currencyInfo(currency).decimals), formatAmount(amount, currency)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Money in and out of the user's own accounts: income and spends only, never
 * transfers or loans. In the home currency at each entry's day (decision
 * 0017); `unpriced` counts entries left out while their rate is unknown.
 */
function flows(rows: readonly TransactionRow[]) {
  let moneyIn = 0;
  let moneyOut = 0;
  let unpriced = 0;
  for (const row of rows) {
    if (row.tx.kind !== 'income' && row.tx.kind !== 'expense') continue;
    if (row.homeAmount === null) {
      unpriced += 1;
      continue;
    }
    const amount = row.homeAmount;
    if (row.tx.kind === 'income' && amount > 0) moneyIn += amount;
    else if (row.tx.kind === 'expense') moneyOut -= amount;
  }
  return { moneyIn, moneyOut, unpriced };
}

/** The longest name among this month's money in, and how many others: "Salary and 2 more". */
function incomeSources(rows: readonly TransactionRow[]): string | null {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const amount = row.homeAmount ?? 0;
    if (row.tx.kind !== 'income' || amount <= 0) continue;
    const name = row.category?.name ?? transactionTitle(row);
    byName.set(name, (byName.get(name) ?? 0) + amount);
  }
  const names = [...byName].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (names.length === 0) return null;
  return names.length === 1 ? names[0]! : `${names[0]} and ${names.length - 1} more`;
}

/** Days of the month counted so far: all of a past month, up to today for this one. */
function daysSoFar(month: MonthKey, thisMonth: MonthKey): number {
  const [year, m] = month.split('-').map(Number) as [number, number];
  if (month === thisMonth) return new Date().getDate();
  return new Date(year, m, 0).getDate();
}

type Quick = 'all' | 'expense' | 'income' | 'review';

/** HOME-2: a month of entries in day cards, with search, quick chips and filters (decision 0015). */
export default function Activity() {
  const insets = useSafeAreaInsets();
  const { data, reload } = useLedger(load, { rows: [] as TransactionRow[], parents: new Map<string, string | null>() }, 'activity');
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);
  const [month, setMonth] = useState<MonthKey>(() => monthOf(new Date()));
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const waiting = useAiWaiting();
  const thisMonth = monthOf(new Date());
  const custom = filters.from !== null || filters.to !== null;

  const inRange = (row: TransactionRow, f: ActivityFilters) => {
    if (f.from === null && f.to === null) return monthOf(new Date(row.tx.occurredAt)) === month;
    const day = dateOf(row.tx.occurredAt);
    return (f.from === null || day >= f.from) && (f.to === null || day <= f.to);
  };
  const count = (f: ActivityFilters) => data.rows.filter((r) => inRange(r, f) && passes(r, f, data.parents)).length;

  const { sections, totals, sources, toReview } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = data.rows.filter((r) => inRange(r, filters) && passes(r, filters, data.parents) && matchesQuery(r, q));
    const days = new Map<string, TransactionRow[]>();
    for (const row of shown) {
      const day = formatDay(row.tx.occurredAt);
      days.set(day, [...(days.get(day) ?? []), row]);
    }
    return {
      totals: flows(shown),
      sources: incomeSources(shown),
      toReview: data.rows.filter((r) => inRange(r, filters) && r.tx.status === 'pending').length,
      sections: [...days].map(([title, rows]) => ({ title, ...flows(rows), data: rows })),
    };
    // inRange reads month and filters, both listed here.
  }, [data, filters, query, month]);

  // Kind and "to review" have their own chips; the rest of the filters show as removable chips.
  const chips = activeChips(filters).filter((chip) => !('kind' in chip.clear) && !('reviewOnly' in chip.clear));
  const filtersOn = activeChips(filters).length > 0;
  const quick: Quick = filters.reviewOnly ? 'review' : filters.kind === 'expense' || filters.kind === 'income' ? filters.kind : 'all';
  const pickQuick = (q: Quick) =>
    setFilters({
      ...filters,
      kind: q === 'expense' || q === 'income' ? q : 'all',
      reviewOnly: q === 'review' ? !filters.reviewOnly : false,
    });
  const perDay = custom ? null : Math.round(totals.moneyOut / daysSoFar(month, thisMonth));

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.tx.id}
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 12 }]}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={insets.top} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title} accessibilityRole="header">
                Activity
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search"
                accessibilityState={{ expanded: searching }}
                onPress={() => {
                  if (searching) setQuery('');
                  setSearching(!searching);
                }}
                style={[styles.roundButton, searching && styles.roundOn]}
              >
                <Feather name={searching ? 'x' : 'search'} size={18} color={searching ? colors.onInk : colors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={filtersOn ? `Filters, ${activeChips(filters).length} on` : 'Filters'}
                onPress={() => setFiltering(true)}
                style={[styles.roundButton, filtersOn && styles.roundOn]}
              >
                <Feather name="sliders" size={18} color={filtersOn ? colors.onInk : colors.text} />
              </Pressable>
            </View>
            {searching && (
              <View style={styles.search}>
                <Feather name="search" size={18} color={colors.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search merchant, category or amount"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Search"
                  style={styles.searchInput}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            {waiting > 0 && (
              // Decision 0012: so a PC that's off reads as waiting, not as a bug.
              <View style={styles.waiting} accessibilityRole="text">
                <Feather name="cpu" size={14} color={colors.muted} />
                <Text style={styles.waitingText}>
                  {waiting} {waiting === 1 ? 'merchant' : 'merchants'} waiting for AI
                </Text>
              </View>
            )}
            {!custom && (
              <View style={styles.months}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} onPress={() => setMonth(addMonths(month, -1))} style={styles.arrow}>
                  <Feather name="chevron-left" size={22} color={colors.text} />
                </Pressable>
                <Text style={styles.month}>{formatMonth(month)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  hitSlop={8}
                  disabled={month >= thisMonth}
                  onPress={() => setMonth(addMonths(month, 1))}
                  style={[styles.arrow, month >= thisMonth && styles.disabled]}
                >
                  <Feather name="chevron-right" size={22} color={colors.text} />
                </Pressable>
              </View>
            )}
            <View style={styles.summary}>
              <Total label="Spent" value={formatWholeRupees(totals.moneyOut)} note={perDay !== null && totals.moneyOut > 0 ? `${formatWholeRupees(perDay)} a day` : null} />
              <Total
                label="Money in"
                value={formatWholeRupees(totals.moneyIn)}
                color={totals.moneyIn > 0 ? colors.primary : undefined}
                note={sources}
              />
            </View>
            {totals.unpriced > 0 && (
              <Text style={styles.waitingText}>
                {totals.unpriced} {totals.unpriced === 1 ? 'entry' : 'entries'} in another currency left out until the exchange rate loads.
              </Text>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickScroll} contentContainerStyle={styles.quick} keyboardShouldPersistTaps="handled">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'expense', label: 'Spends' },
                  { key: 'income', label: 'Money in' },
                ] as const
              ).map((chip) => (
                <Pressable
                  key={chip.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: quick === chip.key }}
                  onPress={() => pickQuick(chip.key)}
                  style={[styles.quickChip, quick === chip.key && styles.quickOn]}
                >
                  <Text style={[styles.quickText, quick === chip.key && styles.quickTextOn]}>{chip.label}</Text>
                </Pressable>
              ))}
              {(toReview > 0 || quick === 'review') && (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: quick === 'review' }}
                  onPress={() => pickQuick('review')}
                  style={[styles.quickChip, styles.reviewChip, quick === 'review' && styles.reviewOn]}
                >
                  <Text style={[styles.quickText, styles.reviewText, quick === 'review' && styles.reviewTextOn]}>To review · {toReview}</Text>
                </Pressable>
              )}
            </ScrollView>
            {chips.length > 0 && (
              <View style={styles.chips}>
                {chips.map((chip) => (
                  <Pressable
                    key={chip.label}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove filter ${chip.label}`}
                    onPress={() => setFilters({ ...filters, ...chip.clear })}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{chip.label}</Text>
                    <Feather name="x" size={14} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.day}>
            <Text style={styles.dayText}>{section.title.toUpperCase()}</Text>
            <Text style={styles.dayTotal}>
              {section.moneyOut > 0 ? `−${formatWholeRupees(section.moneyOut)}` : ''}
              {section.moneyIn > 0 && section.moneyOut > 0 ? ' · ' : ''}
              {section.moneyIn > 0 && <Text style={{ color: colors.primary }}>+{formatWholeRupees(section.moneyIn)}</Text>}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          return (
            <View style={[styles.cardRow, first && styles.cardFirst, last && styles.cardLast]}>
              <View style={[styles.cardInner, !last && styles.cardDivider]}>
                <TransactionItem row={item} showTime />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>{data.rows.length === 0 ? 'No entries yet. They appear as your bank SMS arrive, or tap + on Home to add one.' : 'Nothing matches.'}</Text>}
      />
      <FilterSheet
        visible={filtering}
        value={filters}
        count={count}
        onApply={(f) => {
          setFilters(f);
          setFiltering(false);
        }}
        onClose={() => setFiltering(false)}
      />
    </>
  );
}

function Total({ label, value, color, note }: { label: string; value: string; color?: string; note?: string | null }) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {note ? (
        <Text style={styles.totalLabel} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  header: { gap: 14, paddingBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: { borderColor: colors.ink, backgroundColor: colors.ink },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  month: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  summary: { flexDirection: 'row', gap: 10 },
  total: {
    flex: 1,
    gap: 4,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  totalLabel: { fontSize: 12, color: colors.muted },
  totalValue: { fontSize: 20, fontWeight: '700', color: colors.text, ...figures },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  // The chips run to the screen's edges while scrolling.
  quickScroll: { marginHorizontal: -16 },
  quick: { gap: 8, paddingHorizontal: 16 },
  quickChip: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickOn: { borderColor: colors.ink, backgroundColor: colors.ink },
  quickText: { fontSize: 13, fontWeight: '500', color: colors.text },
  quickTextOn: { color: colors.onInk, fontWeight: '600' },
  reviewChip: { borderColor: colors.warningSurface, backgroundColor: colors.warningSurface },
  reviewOn: { borderColor: colors.warning, backgroundColor: colors.warning },
  reviewText: { color: colors.warning, fontWeight: '600' },
  reviewTextOn: { color: colors.onInk },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.primarySurface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  day: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingTop: 18, paddingBottom: 6 },
  dayText: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },
  dayTotal: { fontSize: 13, fontWeight: '600', color: colors.muted, ...figures },
  // Each day's entries sit in one card.
  cardRow: { paddingHorizontal: 14, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  cardFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 2 },
  cardLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: 2 },
  cardInner: {},
  cardDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  waitingText: { fontSize: 13, color: colors.muted },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 15, marginTop: 48 },
});
