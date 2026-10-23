import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatRupees, isDateKey, parseRupees, splitAmount, type Paise } from '@money-plant/core';
import { CategoryPicker } from '@/components/category-picker';
import { PersonPicker } from '@/components/person-picker';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { listPeople, type Person } from '@/lib/people';
import { today } from '@/lib/recurring';
import { paidBySomeoneElse } from '@/lib/splits';

const HEADCOUNTS = [2, 3, 4, 5, 6];

/** SPL-2: a bill someone else paid; the user's share is spent and owed to them. */
export default function PaidBySomeoneElse() {
  const [people, setPeople] = useState<Person[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [payerId, setPayerId] = useState<string | null>(null);
  const [what, setWhat] = useState('');
  const [total, setTotal] = useState('');
  const [headcount, setHeadcount] = useState<number | null>(null);
  const [myShare, setMyShare] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);
  useEffect(() => {
    reloadPeople();
    categoryNames().then(setNames);
  }, [reloadPeople]);

  // "Split equally among N" fills in the user's share; the first share takes any leftover paisa.
  function splitEqually(n: number) {
    const bill = parseRupees(total);
    setHeadcount(n);
    if (bill === null || bill <= 0) return setError('Enter the whole bill first');
    const result = splitAmount(bill, 'equal', Array.from({ length: n }, (_, i) => ({ id: String(i), value: 0 })));
    if ('shares' in result) setMyShare(formatRupees(result.shares.get(String(n - 1))!, { symbol: false }).replace(/,/g, ''));
    setError(null);
  }

  async function save() {
    if (!payerId) return setError('Pick who paid');
    const share = parseRupees(myShare);
    if (share === null || share <= 0) return setError('Enter your share as a number above zero');
    const bill = total.trim() ? parseRupees(total) : null;
    if (total.trim() && bill === null) return setError('Enter the whole bill as a number, or leave it empty');
    if (!categoryId) return setError('Pick a category for your share');
    if (!isDateKey(occurredOn.trim())) return setError('Enter the date as YYYY-MM-DD');
    if (dueDate.trim() && !isDateKey(dueDate.trim())) return setError('Enter the due date as YYYY-MM-DD, or leave it empty');
    setSaving(true);
    try {
      await paidBySomeoneElse({
        payerId,
        categoryId,
        myShare: share,
        total: bill as Paise | null,
        what,
        occurredOn: occurredOn.trim(),
        dueDate: dueDate.trim() || null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Who paid</Text>
      <PersonPicker
        people={people}
        selected={payerId ? [payerId] : []}
        onToggle={(id) => setPayerId(id === payerId ? null : id)}
        onCreated={(id) => reloadPeople().then(() => setPayerId(id))}
      />
      <Field label="What for" value={what} onChangeText={setWhat} placeholder="Goa trip hotel" maxLength={200} />
      <Field label="Whole bill (₹, optional)" value={total} onChangeText={setTotal} keyboardType="decimal-pad" />
      <Text style={styles.label}>Split equally among</Text>
      <Chips>
        {HEADCOUNTS.map((n) => (
          <Chip key={n} label={`${n} people`} selected={headcount === n} onPress={() => splitEqually(n)} />
        ))}
      </Chips>
      <Field label="Your share (₹)" value={myShare} onChangeText={(text) => (setMyShare(text), setHeadcount(null))} keyboardType="decimal-pad" />

      <Text style={styles.label}>Your share counts toward</Text>
      <Chips>
        <Chip label={categoryId ? (names.get(categoryId) ?? 'Category') : 'Pick a category'} selected={categoryId !== null} onPress={() => setPicking(true)} />
      </Chips>
      <Field label="Date" value={occurredOn} onChangeText={setOccurredOn} autoCapitalize="none" />
      <Field label="Pay back by (optional)" value={dueDate} onChangeText={setDueDate} placeholder="2026-11-30" autoCapitalize="none" />
      <Text style={styles.hint}>Your share counts as spending now, and as money you owe them until you pay it back.</Text>

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
      <CategoryPicker
        visible={picking}
        flow="expense"
        onPick={(category) => {
          setCategoryId(category.id);
          setNames(new Map(names).set(category.id, category.name));
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
});
