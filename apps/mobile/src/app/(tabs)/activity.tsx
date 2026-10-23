import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { formatAmount, formatDay } from '@/components/format';
import { transactionTitle, TransactionItem } from '@/components/transaction-item';
import { Chip, colors, radius } from '@/components/ui';
import { listTransactions, type TransactionRow } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'expense', label: 'Spends' },
  { key: 'income', label: 'Income' },
  { key: 'transfer', label: 'Transfers' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

function matches(row: TransactionRow, filter: Filter, query: string): boolean {
  if (filter !== 'all' && row.tx.kind !== filter) return false;
  if (!query) return true;
  const amount = Math.abs(row.legs[0]?.amount ?? 0);
  const haystack = [transactionTitle(row), row.category?.name ?? '', row.tx.note ?? '', String(amount / 100), formatAmount(amount)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/** Every entry, newest first, grouped by day, with a search and a type filter. */
export default function Activity() {
  const { data } = useLedger(() => listTransactions(), [] as TransactionRow[]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const days = new Map<string, TransactionRow[]>();
    for (const row of data) {
      if (!matches(row, filter, q)) continue;
      const day = formatDay(row.tx.occurredAt);
      days.set(day, [...(days.get(day) ?? []), row]);
    }
    return [...days].map(([title, rows]) => {
      const spent = rows.filter((r) => r.tx.kind === 'expense').reduce((sum, r) => sum - (r.legs[0]?.amount ?? 0), 0);
      return { title, spent, data: rows };
    });
  }, [data, filter, query]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.tx.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
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
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.day}>
          <Text style={styles.dayText}>{section.title}</Text>
          {section.spent > 0 && <Text style={styles.dayText}>Spent {formatAmount(section.spent)}</Text>}
        </View>
      )}
      renderItem={({ item }) => <TransactionItem row={item} />}
      ListEmptyComponent={<Text style={styles.empty}>{data.length === 0 ? 'No entries yet.' : 'Nothing matches.'}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  header: { gap: 12, paddingBottom: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.subtle,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  filters: { flexDirection: 'row', gap: 8 },
  day: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 4 },
  dayText: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.3 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 15, marginTop: 48 },
});
