import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatRupees, parseRupees, type Paise } from '@money-plant/core';
import { normaliseMerchant, type PatternMatch, type Rule, type RuleMatch } from '@money-plant/categoriser';
import { CategoryPicker } from '@/components/category-picker';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { categoryNames, recategoriseHistory } from '@/lib/categories';
import { deleteRule, getRule, updateRule } from '@/lib/rules-store';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const money = (amount: Paise | undefined) => (amount === undefined ? '' : formatRupees(amount, { symbol: false }).replace(/\.00$/, ''));
const hour = (minute: number) => String(Math.floor(minute / 60));

/** CAT-7: edit, pause or delete one rule or pattern. */
export default function RuleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rule, setRule] = useState<Rule | null>(null);
  const [category, setCategory] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getRule(id), categoryNames()]).then(([loaded, names]) => {
      if (!loaded) return;
      setRule(loaded);
      setCategory({ id: loaded.categoryId, name: names.get(loaded.categoryId) ?? 'Deleted category' });
      setAutoConfirm(loaded.autoConfirm);
      const { match } = loaded;
      setMin(money(match.minAmount));
      setMax(money(match.maxAmount));
      if (match.kind === 'rule') setText(match.vpa ?? match.merchant ?? match.keyword ?? '');
      else {
        setFrom(hour(match.startMinute));
        setTo(hour(match.endMinute));
        setDays(match.weekdays);
      }
    });
  }, [id]);

  if (!rule || !category) return null;
  const { match } = rule;
  const usesKeyword = match.kind === 'rule' && match.keyword !== undefined;

  function amount(value: string): Paise | undefined | null {
    if (value.trim() === '') return undefined;
    const parsed = parseRupees(value);
    return parsed !== null && parsed >= 0 ? parsed : null;
  }

  async function save() {
    const minAmount = amount(min);
    const maxAmount = amount(max);
    if (minAmount === null || maxAmount === null) return setError('Amounts must be numbers');
    let next: RuleMatch | PatternMatch;
    if (match.kind === 'rule') {
      const value = text.trim().toLowerCase();
      if (!value) return setError('Enter a merchant name or UPI ID');
      next = {
        kind: 'rule',
        direction: match.direction,
        ...(value.includes('@') ? { vpa: value } : usesKeyword ? { keyword: normaliseMerchant(value) } : { merchant: normaliseMerchant(value) }),
        ...(minAmount !== undefined ? { minAmount } : {}),
        ...(maxAmount !== undefined ? { maxAmount } : {}),
      };
    } else {
      const start = Number(from);
      const end = Number(to);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) {
        return setError('Hours go from 0 to 24, and the start must be before the end');
      }
      if (minAmount === undefined || maxAmount === undefined || minAmount > maxAmount) return setError('Enter the lowest and highest amount');
      if (days.length === 0) return setError('Pick at least one day');
      next = { ...match, minAmount, maxAmount, startMinute: start * 60, endMinute: end * 60, weekdays: [...days].sort() };
    }
    await updateRule(id, { match: next, categoryId: category!.id, autoConfirm });
    await recategoriseHistory({ uncategorisedOnly: match.kind === 'pattern' });
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {match.kind === 'rule' ? (
        <Field
          label={usesKeyword ? 'Merchant name contains' : 'Merchant name or UPI ID'}
          value={text}
          onChangeText={setText}
          autoCapitalize="none"
        />
      ) : (
        <>
          <Text style={styles.label}>Days</Text>
          <Chips>
            {DAYS.map((d, i) => (
              <Chip key={d} label={d} selected={days.includes(i)} onPress={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} />
            ))}
          </Chips>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field label="From hour (0 to 23)" value={from} onChangeText={setFrom} keyboardType="number-pad" />
            </View>
            <View style={styles.half}>
              <Field label="To hour (1 to 24)" value={to} onChangeText={setTo} keyboardType="number-pad" />
            </View>
          </View>
        </>
      )}
      <View style={styles.pair}>
        <View style={styles.half}>
          <Field label={match.kind === 'rule' ? 'Lowest amount (optional)' : 'Lowest amount'} value={min} onChangeText={setMin} keyboardType="decimal-pad" />
        </View>
        <View style={styles.half}>
          <Field label={match.kind === 'rule' ? 'Highest amount (optional)' : 'Highest amount'} value={max} onChangeText={setMax} keyboardType="decimal-pad" />
        </View>
      </View>

      <Text style={styles.label}>Category</Text>
      <Button title={category.name} variant="secondary" onPress={() => setPicking(true)} />
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Confirm matches without asking</Text>
        <Switch value={autoConfirm} onValueChange={setAutoConfirm} />
      </View>
      <Text style={styles.meta}>
        Right {rule.hits} times, corrected {rule.misses} times.
      </Text>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} />
        <Button
          title={rule.status === 'paused' ? 'Resume' : 'Pause'}
          variant="secondary"
          onPress={() => updateRule(id, { status: rule.status === 'paused' ? 'active' : 'paused' }).then(() => router.back())}
        />
        <Button
          title="Delete"
          variant="secondary"
          onPress={() =>
            Alert.alert('Delete this rule?', 'Entries it already categorised keep their category.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteRule(id).then(() => router.back()) },
            ])
          }
        />
      </View>
      <CategoryPicker
        visible={picking}
        flow={match.direction === 'credit' ? undefined : 'expense'}
        onPick={(node) => {
          setCategory({ id: node.id, name: node.name });
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 4 },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6, marginTop: 16 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  switchLabel: { fontSize: 15, color: colors.text, flex: 1 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 8 },
  actions: { marginTop: 24, gap: 12 },
});
