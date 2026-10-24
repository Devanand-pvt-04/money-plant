import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { paise } from '@money-plant/core';
import { AccountPicker, accountIcon, accountLabel } from '@/components/account-picker';
import { CategoryPicker } from '@/components/category-picker';
import { formatWhen, pickDateTime } from '@/components/date-fields';
import { formatWholeRupees } from '@/components/format';
import { CategoryIcon } from '@/components/sheet';
import { Button, colors, radius } from '@/components/ui';
import { categoryNames, type CategoryNode } from '@/lib/categories';
import { addManualEntry, addManualTransfer } from '@/lib/entries';
import type { AccountBalance } from '@/lib/ledger';
import { quickAddDefaults, rememberAccount, type QuickAddDefaults } from '@/lib/quick-add';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;
const MAX_RUPEE_DIGITS = 9;

/** "1250.5" typed on the keypad as integer paise, without floating point. */
function toPaise(text: string): number {
  const [rupees = '', fraction = ''] = text.split('.');
  return Number(rupees || '0') * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

/** The amount as typed, with Indian grouping: "₹1,250.5". */
function display(text: string): string {
  const [rupees = '', fraction] = text.split('.');
  const whole = formatWholeRupees(Number(rupees || '0') * 100);
  return fraction === undefined ? whole : `${whole}.${fraction}`;
}

function press(text: string, key: (typeof KEYS)[number]): string {
  if (key === 'del') return text.slice(0, -1);
  const [rupees = '', fraction] = text.split('.');
  if (key === '.') return fraction !== undefined ? text : `${rupees || '0'}.`;
  if (fraction !== undefined) return fraction.length >= 2 ? text : text + key;
  if (rupees === '0') return key;
  return rupees.length >= MAX_RUPEE_DIGITS ? text : text + key;
}

type Mode = 'debit' | 'credit' | 'transfer';
const MODE_LABELS: Record<Mode, string> = { debit: 'Spent', credit: 'Received', transfer: 'Transfer' };

/**
 * CAP-7: a spend, money in or a transfer in three taps: +, the amount, Save.
 * The category, accounts and time start from smart defaults and each opens
 * its own picker (NAV-2).
 */
export default function QuickAdd() {
  const insets = useSafeAreaInsets();
  const [defaults, setDefaults] = useState<QuickAddDefaults | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [mode, setMode] = useState<Mode>('debit');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<CategoryNode | null>(null);
  const [from, setFrom] = useState<AccountBalance | null>(null);
  const [to, setTo] = useState<AccountBalance | null>(null);
  const [when, setWhen] = useState(() => new Date().toISOString());
  const [note, setNote] = useState<string | null>(null);
  const [picking, setPicking] = useState<'category' | 'from' | 'to' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([quickAddDefaults(), categoryNames()]).then(([d, n]) => {
      setDefaults(d);
      setNames(n);
      const account = d.accounts.find((b) => b.account.id === d.accountId) ?? null;
      setFrom(account);
      setTo(d.accounts.find((b) => b.account.id !== account?.account.id && b.account.type === 'cash') ?? d.accounts.find((b) => b.account.id !== account?.account.id) ?? null);
      setCategory(d.suggestions.debit[0] ?? null);
    });
  }, []);

  if (!defaults) return <View style={styles.screen} />;

  const amount = toPaise(text);
  const transfer = mode === 'transfer';
  const ready = amount > 0 && from !== null && (transfer ? to !== null && to.account.id !== from.account.id : category !== null);
  const suggestions = transfer ? [] : defaults.suggestions[mode];
  const hint = !transfer && category?.id === suggestions[0]?.id ? defaults.hint[mode] : null;

  function switchMode(next: Mode) {
    setMode(next);
    if (next !== 'transfer') setCategory(defaults!.suggestions[next][0] ?? null);
  }

  async function save() {
    if (!ready) return;
    setSaving(true);
    try {
      const occurredAt = when;
      if (transfer) {
        await addManualTransfer({ fromId: from!.account.id, toId: to!.account.id, amount: paise(amount), note, occurredAt });
      } else {
        await addManualEntry({ direction: mode, amount: paise(amount), accountId: from!.account.id, categoryId: category!.id, note, occurredAt });
        await rememberAccount(from!.account.id);
      }
      router.back();
    } catch (e) {
      setSaving(false);
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    }
  }

  if (defaults.accounts.length === 0) {
    return (
      <View style={[styles.screen, styles.empty, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.emptyTitle}>Add an account first</Text>
        <Text style={styles.hint}>Quick add needs somewhere to take the money from, like Cash or a bank account.</Text>
        <Button title="Add account" onPress={() => router.replace('/add-account')} />
      </View>
    );
  }

  const accountTile = (label: string, account: AccountBalance | null, which: 'from' | 'to') => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${account ? accountLabel(account.account) : 'pick an account'}`}
      onPress={() => setPicking(which)}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Feather name={account ? accountIcon(account.account.type) : 'plus'} size={18} color={colors.muted} />
      <View style={styles.tileText}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={styles.tileValue} numberOfLines={1}>
          {account ? accountLabel(account.account) : 'Pick'}
        </Text>
      </View>
    </Pressable>
  );

  const whenTile = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`When: ${formatWhen(when)}`}
      onPress={() => pickDateTime(when, setWhen)}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Feather name="calendar" size={18} color={colors.muted} />
      <View style={styles.tileText}>
        <Text style={styles.tileLabel}>When</Text>
        <Text style={styles.tileValue} numberOfLines={1}>
          {formatWhen(when)}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => router.back()} style={styles.close}>
          <Feather name="x" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.segment}>
          {(['debit', 'credit', 'transfer'] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === m }}
              onPress={() => switchMode(m)}
              style={[styles.segmentItem, mode === m && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>{MODE_LABELS[m]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.close} />
      </View>

      <View style={styles.amountBox}>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.amount, amount === 0 && styles.amountEmpty, mode === 'credit' && amount > 0 && styles.amountIn]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {display(text)}
        </Text>
        {note === null ? (
          <Pressable accessibilityRole="button" onPress={() => setNote('')} style={styles.notePill}>
            <Text style={styles.notePillText}>Add a note</Text>
          </Pressable>
        ) : (
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What was it for?"
            placeholderTextColor={colors.placeholder}
            style={styles.noteInput}
            maxLength={200}
            autoFocus
            returnKeyType="done"
            onBlur={() => !note.trim() && setNote(null)}
          />
        )}
        {transfer && <Text style={styles.hint}>A transfer isn't spending. Transfers both banks send SMS for are added on their own.</Text>}
      </View>

      <View style={styles.pickers}>
        {!transfer && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Category: ${category ? names.get(category.id) ?? category.name : 'pick one'}`}
            onPress={() => setPicking('category')}
            style={({ pressed }) => [styles.categoryRow, pressed && styles.pressed]}
          >
            <CategoryIcon categoryKey={category?.key ?? null} size={32} />
            <View style={styles.tileText}>
              <Text style={styles.categoryName} numberOfLines={1}>
                {category ? names.get(category.id) ?? category.name : 'Pick a category'}
              </Text>
              {hint && (
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {hint}
                </Text>
              )}
            </View>
            <Feather name="chevron-down" size={18} color={colors.muted} />
          </Pressable>
        )}
        <View style={styles.tiles}>
          {accountTile(mode === 'credit' ? 'Into' : 'From', from, 'from')}
          {transfer ? accountTile('To', to, 'to') : whenTile}
        </View>
        {transfer && whenTile}
      </View>

      <View style={styles.keys}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
            onPress={() => setText((t) => press(t, k))}
            onLongPress={k === 'del' ? () => setText('') : undefined}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          >
            {k === 'del' ? <Feather name="delete" size={22} color={colors.text} /> : <Text style={styles.keyText}>{k}</Text>}
          </Pressable>
        ))}
      </View>

      <View style={styles.save}>
        <Button title={amount > 0 ? `Save ${display(text)}` : 'Save'} onPress={save} disabled={!ready} loading={saving} />
      </View>

      <CategoryPicker
        visible={picking === 'category'}
        flow={mode === 'credit' ? 'income' : 'expense'}
        onPick={(c) => {
          setPicking(null);
          setCategory(c);
          categoryNames().then(setNames);
        }}
        onClose={() => setPicking(null)}
      />
      <AccountPicker
        visible={picking === 'from' || picking === 'to'}
        title={picking === 'to' ? 'To' : mode === 'credit' ? 'Into' : 'From'}
        exclude={transfer ? [(picking === 'to' ? from : to)?.account.id ?? ''] : []}
        onPick={(account) => {
          if (picking === 'to') setTo(account);
          else setFrom(account);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  empty: { paddingHorizontal: 24, gap: 12, justifyContent: 'center' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  segment: { flex: 1, flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.pill, padding: 3 },
  segmentItem: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  amountBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  amount: { fontSize: 56, fontWeight: '700', letterSpacing: -1.5, color: colors.text, fontVariant: ['tabular-nums'] },
  amountEmpty: { color: colors.placeholder },
  amountIn: { color: colors.primary },
  notePill: { minHeight: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.subtle, justifyContent: 'center' },
  notePillText: { fontSize: 13, color: colors.secondary },
  noteInput: {
    minWidth: 200,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.subtle,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  pickers: { gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  pressed: { backgroundColor: colors.pressed },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryName: { fontSize: 15, fontWeight: '600', color: colors.text },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileText: { flex: 1, gap: 1 },
  tileLabel: { fontSize: 11, color: colors.muted },
  tileValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  keys: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8 },
  key: { width: '33.33%', height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  keyPressed: { backgroundColor: colors.pressed },
  keyText: { fontSize: 26, fontWeight: '500', color: colors.text },
  save: { paddingHorizontal: 16, paddingTop: 8 },
});
