import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { paise } from '@money-plant/core';
import { CategoryPicker } from '@/components/category-picker';
import { formatWholeRupees } from '@/components/format';
import { Button, Chip, colors, radius } from '@/components/ui';
import type { CategoryNode } from '@/lib/categories';
import { addManualEntry } from '@/lib/entries';
import { quickAddDefaults, rememberAccount, type QuickAddDefaults } from '@/lib/quick-add';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;
const MAX_RUPEE_DIGITS = 9;
const SHOWN_CATEGORIES = 5;

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

/** CAP-7: a cash or other spend in three taps: +, the amount, Save. */
export default function QuickAdd() {
  const insets = useSafeAreaInsets();
  const [defaults, setDefaults] = useState<QuickAddDefaults | null>(null);
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [extra, setExtra] = useState<CategoryNode | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    quickAddDefaults().then((d) => {
      setDefaults(d);
      setAccountId(d.accountId);
      setCategoryId(d.suggestions.debit[0]?.id ?? null);
    });
  }, []);

  if (!defaults) return <View style={styles.screen} />;

  const suggestions = defaults.suggestions[direction];
  const shown = suggestions.slice(0, SHOWN_CATEGORIES);
  if (extra && !shown.some((c) => c.id === extra.id)) shown.unshift(extra);
  const amount = toPaise(text);
  const ready = amount > 0 && categoryId !== null && accountId !== null;
  const hint = categoryId === suggestions[0]?.id ? defaults.hint[direction] : null;

  function switchDirection(next: 'debit' | 'credit') {
    setDirection(next);
    setExtra(null);
    setCategoryId(defaults!.suggestions[next][0]?.id ?? null);
  }

  async function save() {
    if (!ready) return;
    setSaving(true);
    try {
      await addManualEntry({ direction, amount: paise(amount), accountId: accountId!, categoryId: categoryId! });
      await rememberAccount(accountId!);
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => router.back()} style={styles.close}>
          <Feather name="x" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.segment}>
          {(['debit', 'credit'] as const).map((d) => (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ selected: direction === d }}
              onPress={() => switchDirection(d)}
              style={[styles.segmentItem, direction === d && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, direction === d && styles.segmentTextOn]}>{d === 'debit' ? 'Spent' : 'Received'}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.close} />
      </View>

      <View style={styles.amountBox}>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.amount, amount === 0 && styles.amountEmpty, direction === 'credit' && amount > 0 && styles.amountIn]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {display(text)}
        </Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
      </View>

      <View style={styles.pickers}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
          {shown.map((c) => (
            <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
          ))}
          <Chip label="More…" selected={false} onPress={() => setPicking(true)} />
        </ScrollView>
        {defaults.accounts.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {defaults.accounts.map((b) => (
              <Pressable
                key={b.account.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: accountId === b.account.id }}
                onPress={() => setAccountId(b.account.id)}
                style={[styles.account, accountId === b.account.id && styles.accountOn]}
              >
                <Feather name={b.account.type === 'cash' ? 'dollar-sign' : 'credit-card'} size={14} color={accountId === b.account.id ? colors.ink : colors.muted} />
                <Text style={[styles.accountText, accountId === b.account.id && styles.accountTextOn]}>{b.account.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
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
        <Button title={direction === 'debit' ? 'Save spend' : 'Save money in'} onPress={save} disabled={!ready} loading={saving} />
      </View>

      <CategoryPicker
        visible={picking}
        flow={direction === 'debit' ? 'expense' : 'income'}
        onPick={(c) => {
          setPicking(false);
          setExtra(c);
          setCategoryId(c.id);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  empty: { paddingHorizontal: 24, gap: 12, justifyContent: 'center' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.pill, padding: 3 },
  segmentItem: { minHeight: 38, paddingHorizontal: 18, borderRadius: radius.pill, justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.surface, elevation: 1 },
  segmentText: { fontSize: 14, fontWeight: '500', color: colors.muted },
  segmentTextOn: { color: colors.text, fontWeight: '600' },
  amountBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  amount: { fontSize: 52, fontWeight: '700', letterSpacing: -1.5, color: colors.text, fontVariant: ['tabular-nums'] },
  amountEmpty: { color: colors.placeholder },
  amountIn: { color: colors.primary },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  pickers: { gap: 10, paddingBottom: 12 },
  row: { gap: 8, paddingHorizontal: 20 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountOn: { borderColor: colors.ink },
  accountText: { fontSize: 13, color: colors.muted },
  accountTextOn: { color: colors.ink, fontWeight: '600' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
  key: { width: '33.33%', height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  keyPressed: { backgroundColor: colors.pressed },
  keyText: { fontSize: 26, fontWeight: '500', color: colors.text },
  save: { paddingHorizontal: 20, paddingTop: 8 },
});
