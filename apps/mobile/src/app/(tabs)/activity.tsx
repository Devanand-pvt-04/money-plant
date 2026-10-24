import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, dateOf, monthOf, type MonthKey } from '@money-plant/core';
import { FilterSheet, NO_FILTERS, activeChips, passes, type ActivityFilters } from '@/components/activity-filters';
import { formatAmount, formatDay, formatMonth, formatWholeRupees } from '@/components/format';
import { transactionTitle, TransactionItem } from '@/components/transaction-item';
import { colors, radius } from '@/components/ui';
import { flatten, listCategories } from '@/lib/categories';
import { listTransactions, type TransactionRow } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const [rows, tree] = await Promise.all([listTransactions(), listCategories()]);
  return { rows, parents: new Map(flatten(tree).map((c) => [c.id, c.parentId])) };
}

function matchesQuery(row: TransactionRow, query: string): boolean {
  if (!query) return true;
  const amount = Math.abs(row.legs[0]?.amount ?? 0);
  const haystack = [transactionTitle(row), row.category?.name ?? '', row.tx.note ?? '', String(amount / 100), formatAmount(amount)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/** Money in and out of the user's own accounts: income and spends only, never transfers or loans. */
function flows(rows: readonly TransactionRow[]) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const row of rows) {
    const amount = row.legs[0]?.amount ?? 0;
    if (row.tx.kind === 'income' && amount > 0) moneyIn += amount;
    else if (row.tx.kind === 'expense') moneyOut -= amount;
  }
  return { moneyIn, moneyOut };
}

/** HOME-2: a month of entries, grouped by day, with search and filters. */
export default function Activity() {
  const { data } = useLedger(load, { rows: [] as TransactionRow[], parents: new Map<string, string | null>() });
  const [month, setMonth] = useState<MonthKey>(() => monthOf(new Date()));
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState('');
  const thisMonth = monthOf(new Date());
  const custom = filters.from !== null || filters.to !== null;

  const inRange = (row: TransactionRow, f: ActivityFilters) => {
    if (f.from === null && f.to === null) return monthOf(new Date(row.tx.occurredAt)) === month;
    const day = dateOf(row.tx.occurredAt);
    return (f.from === null || day >= f.from) && (f.to === null || day <= f.to);
  };
  const count = (f: ActivityFilters) => data.rows.filter((r) => inRange(r, f) && passes(r, f, data.parents)).length;

  const { sections, totals } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = data.rows.filter((r) => inRange(r, filters) && passes(r, filters, data.parents) && matchesQuery(r, q));
    const days = new Map<string, TransactionRow[]>();
    for (const row of shown) {
      const day = formatDay(row.tx.occurredAt);
      days.set(day, [...(days.get(day) ?? []), row]);
    }
    return {
      totals: flows(shown),
      sections: [...days].map(([title, rows]) => ({ title, ...flows(rows), data: rows })),
    };
    // inRange reads month and filters, both listed here.
  }, [data, filters, query, month]);

  const chips = activeChips(filters);
  const net = totals.moneyIn - totals.moneyOut;

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.tx.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            {!custom && (
              <View style={styles.months}>
                <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} onPress={() => setMonth(addMonths(month, -1))} style={styles.arrow}>
                  <Feather name="chevron-left" size={22} color={colors.text} />
                </Pressable>
                <Text style={styles.month}>{month === thisMonth ? formatMonth(month).split(' ')[0] : formatMonth(month)}</Text>
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
              <Total label="In" value={formatWholeRupees(totals.moneyIn)} color={totals.moneyIn > 0 ? colors.primary : undefined} />
              <Total label="Out" value={formatWholeRupees(totals.moneyOut)} />
              <Total label="Net" value={`${net > 0 ? '+' : ''}${formatWholeRupees(net)}`} color={net < 0 ? colors.danger : undefined} />
            </View>
            <View style={styles.searchRow}>
              <View style={styles.search}>
                <Feather name="search" size={18} color={colors.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search merchant, category or amount"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Search"
                  style={styles.searchInput}
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={chips.length > 0 ? `Filters, ${chips.length} on` : 'Filters'}
                onPress={() => setFiltering(true)}
                style={[styles.filterButton, chips.length > 0 && styles.filterOn]}
              >
                <Feather name="sliders" size={18} color={chips.length > 0 ? colors.onInk : colors.text} />
              </Pressable>
            </View>
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
            <Text style={styles.dayText}>{section.title}</Text>
            <Text style={styles.dayText}>
              {section.moneyIn > 0 && <Text style={{ color: colors.primary }}>+{formatAmount(section.moneyIn)}</Text>}
              {section.moneyIn > 0 && section.moneyOut > 0 ? ' · ' : ''}
              {section.moneyOut > 0 ? `−${formatAmount(section.moneyOut)}` : ''}
            </Text>
          </View>
        )}
        renderItem={({ item }) => <TransactionItem row={item} showTime />}
        ListEmptyComponent={<Text style={styles.empty}>{data.rows.length === 0 ? 'No entries yet.' : 'Nothing matches.'}</Text>}
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

function Total({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  header: { gap: 12, paddingBottom: 4 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  month: { fontSize: 16, fontWeight: '600', color: colors.text, minWidth: 120, textAlign: 'center' },
  summary: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.subtle },
  total: { flex: 1, gap: 4 },
  totalLabel: { fontSize: 12, color: colors.muted },
  totalValue: { fontSize: 17, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.subtle,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  filterButton: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.primarySurface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  day: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 4 },
  dayText: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.3 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 15, marginTop: 48 },
});
