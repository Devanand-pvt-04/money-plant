import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { parseRupees, type DateKey, type Paise } from '@money-plant/core';
import type { SourceKind } from '@money-plant/matcher';
import type { TransactionRow } from '@/lib/ledger';
import { AccountPicker, accountLabel } from './account-picker';
import { CategoryPicker } from './category-picker';
import { DateField } from './date-fields';
import { formatAmount } from './format';
import { Sheet } from './sheet';
import { Button, colors, radius } from './ui';

export type Kind = 'all' | 'expense' | 'income' | 'transfer';
export type Origin = 'sms' | 'app' | 'manual';

/** HOME-2: what the Activity list is narrowed to. Dates, when set, replace the month. */
export interface ActivityFilters {
  kind: Kind;
  from: DateKey | null;
  to: DateKey | null;
  account: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  min: Paise | null;
  max: Paise | null;
  origins: readonly Origin[];
  reviewOnly: boolean;
}

export const NO_FILTERS: ActivityFilters = {
  kind: 'all',
  from: null,
  to: null,
  account: null,
  category: null,
  min: null,
  max: null,
  origins: [],
  reviewOnly: false,
};

const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expense', label: 'Spends' },
  { key: 'income', label: 'Income' },
  { key: 'transfer', label: 'Transfers' },
];
const ORIGINS: { key: Origin; label: string; kinds: readonly SourceKind[] }[] = [
  { key: 'sms', label: 'Bank SMS', kinds: ['sms', 'shortcut', 'statement'] },
  { key: 'app', label: 'UPI app', kinds: ['notification', 'app_payment'] },
  { key: 'manual', label: 'Added by me', kinds: ['manual'] },
];

/** The entry's own amount, positive. */
const sizeOf = (row: TransactionRow) => Math.abs(row.legs[0]?.amount ?? 0);

/**
 * Whether a row passes every filter but the date range. `parents` maps a
 * category to its parent, so picking Food also shows Food › Lunch.
 */
export function passes(row: TransactionRow, f: ActivityFilters, parents: ReadonlyMap<string, string | null>): boolean {
  const { tx } = row;
  if (f.kind !== 'all' && tx.kind !== f.kind) return false;
  if (f.account && !tx.postings.some((p) => p.accountId === f.account!.id)) return false;
  if (f.category) {
    const id = row.category?.id;
    if (!id || (id !== f.category.id && parents.get(id) !== f.category.id)) return false;
  }
  if (f.min !== null && sizeOf(row) < f.min) return false;
  if (f.max !== null && sizeOf(row) > f.max) return false;
  if (f.origins.length > 0) {
    const kinds = new Set(ORIGINS.filter((o) => f.origins.includes(o.key)).flatMap((o) => o.kinds));
    if (!tx.sources.some((s) => kinds.has(s.kind))) return false;
  }
  if (f.reviewOnly && tx.status !== 'pending') return false;
  return true;
}

/** Short labels for the active filters, each with how to clear it. */
export function activeChips(f: ActivityFilters): { label: string; clear: Partial<ActivityFilters> }[] {
  const chips: { label: string; clear: Partial<ActivityFilters> }[] = [];
  if (f.kind !== 'all') chips.push({ label: KINDS.find((k) => k.key === f.kind)!.label, clear: { kind: 'all' } });
  if (f.from || f.to) chips.push({ label: 'Custom dates', clear: { from: null, to: null } });
  if (f.account) chips.push({ label: f.account.name, clear: { account: null } });
  if (f.category) chips.push({ label: f.category.name, clear: { category: null } });
  if (f.min !== null || f.max !== null) {
    const label = f.min !== null && f.max !== null ? `${formatAmount(f.min)} to ${formatAmount(f.max)}` : f.min !== null ? `${formatAmount(f.min)} or more` : `Up to ${formatAmount(f.max!)}`;
    chips.push({ label, clear: { min: null, max: null } });
  }
  for (const o of f.origins) chips.push({ label: ORIGINS.find((x) => x.key === o)!.label, clear: { origins: f.origins.filter((x) => x !== o) } });
  if (f.reviewOnly) chips.push({ label: 'To review', clear: { reviewOnly: false } });
  return chips;
}

/** HOME-2: the filter sheet. Changes apply when the user taps Show. */
export function FilterSheet(props: { visible: boolean; value: ActivityFilters; count: (f: ActivityFilters) => number; onApply: (f: ActivityFilters) => void; onClose: () => void }) {
  const [f, setF] = useState<ActivityFilters>(props.value);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [picking, setPicking] = useState<'account' | 'category' | null>(null);

  useEffect(() => {
    if (!props.visible) return;
    setF(props.value);
    setMin(props.value.min !== null ? String(props.value.min / 100) : '');
    setMax(props.value.max !== null ? String(props.value.max / 100) : '');
  }, [props.visible, props.value]);

  const set = (change: Partial<ActivityFilters>) => setF((current) => ({ ...current, ...change }));
  const amount = (text: string) => {
    const parsed = text.trim() ? parseRupees(text) : null;
    return parsed !== null && parsed > 0 ? parsed : null;
  };
  const next = { ...f, min: amount(min), max: amount(max) };

  return (
    <Sheet visible={props.visible} onClose={props.onClose} tall>
      <View style={styles.head}>
        <Text style={styles.title}>Filters</Text>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setF(NO_FILTERS);
            setMin('');
            setMax('');
          }}
        >
          <Text style={styles.clear}>Clear all</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Type</Text>
        <View style={styles.segment}>
          {KINDS.map((k) => (
            <Pressable
              key={k.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: f.kind === k.key }}
              onPress={() => set({ kind: k.key })}
              style={[styles.segmentItem, f.kind === k.key && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, f.kind === k.key && styles.segmentTextOn]}>{k.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Dates</Text>
        <View style={styles.pair}>
          <DateField label="From" value={f.from} onChange={(from) => set({ from })} optional placeholder="Start of month" max={f.to ?? undefined} style={styles.half} />
          <DateField label="To" value={f.to} onChange={(to) => set({ to })} optional placeholder="End of month" min={f.from ?? undefined} style={styles.half} />
        </View>

        <PickRow label="Account" value={f.account?.name ?? 'Any'} onPress={() => setPicking('account')} onClear={f.account ? () => set({ account: null }) : undefined} />
        <PickRow label="Category" value={f.category?.name ?? 'Any'} onPress={() => setPicking('category')} onClear={f.category ? () => set({ category: null }) : undefined} />

        <Text style={styles.label}>Amount</Text>
        <View style={styles.pair}>
          <TextInput value={min} onChangeText={setMin} placeholder="At least ₹" placeholderTextColor={colors.placeholder} keyboardType="decimal-pad" style={[styles.input, styles.half]} />
          <TextInput value={max} onChangeText={setMax} placeholder="At most ₹" placeholderTextColor={colors.placeholder} keyboardType="decimal-pad" style={[styles.input, styles.half]} />
        </View>

        <Text style={styles.label}>Came from</Text>
        <View style={styles.pair}>
          {ORIGINS.map((o) => {
            const on = f.origins.includes(o.key);
            return (
              <Pressable
                key={o.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => set({ origins: on ? f.origins.filter((x) => x !== o.key) : [...f.origins, o.key] })}
                style={[styles.origin, on && styles.originOn]}
              >
                <Text style={[styles.originText, on && styles.originTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.toggle}>
          <Text style={styles.toggleText}>Only entries to review</Text>
          <Switch value={f.reviewOnly} onValueChange={(reviewOnly) => set({ reviewOnly })} />
        </View>
      </ScrollView>
      <Button title={`Show ${props.count(next)} entries`} onPress={() => props.onApply(next)} />

      <AccountPicker
        visible={picking === 'account'}
        onPick={(b) => {
          set({ account: { id: b.account.id, name: accountLabel(b.account) } });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <CategoryPicker
        visible={picking === 'category'}
        allowCreate={false}
        onPick={(c) => {
          set({ category: { id: c.id, name: c.name } });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Sheet>
  );
}

function PickRow(props: { label: string; value: string; onPress: () => void; onClear?: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.pick, pressed && styles.pressed]}>
      <View style={styles.grow}>
        <Text style={styles.pickLabel}>{props.label}</Text>
        <Text style={styles.pickValue}>{props.value}</Text>
      </View>
      {props.onClear ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${props.label.toLowerCase()}`} hitSlop={8} onPress={props.onClear}>
          <Feather name="x" size={18} color={colors.muted} />
        </Pressable>
      ) : (
        <Feather name="chevron-right" size={18} color={colors.muted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 4 },
  title: { fontSize: 19, fontWeight: '700', color: colors.text },
  clear: { fontSize: 14, fontWeight: '600', color: colors.muted },
  body: { gap: 8, paddingBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8 },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  pair: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.subtle, marginTop: 8 },
  pressed: { opacity: 0.8 },
  grow: { flex: 1 },
  pickLabel: { fontSize: 12, color: colors.muted },
  pickValue: { fontSize: 15, fontWeight: '500', color: colors.text, marginTop: 2 },
  input: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 15, color: colors.text, backgroundColor: colors.subtle },
  origin: { flex: 1, minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  originOn: { borderColor: colors.primary },
  originText: { fontSize: 13, color: colors.text },
  originTextOn: { color: colors.primary, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 8 },
  toggleText: { fontSize: 15, color: colors.text },
});
