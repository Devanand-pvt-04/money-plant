import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SPLIT_METHOD_LABELS, formatRupees, isDateKey, parseRupees, splitAmount, type Paise, type SplitMethod, type SplitPart } from '@money-plant/core';
import { CategoryPicker } from '@/components/category-picker';
import { DateField } from '@/components/date-fields';
import { formatAmount } from '@/components/format';
import { PersonPicker } from '@/components/person-picker';
import { Button, Card, Chip, Chips, ErrorText, colors, radius } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { listPeople, type Person } from '@/lib/people';
import { currentSplit, listGroups, splitEntry, splittable, unsplit, type SplitGroup } from '@/lib/splits';

const ME = 'me';
const METHODS: SplitMethod[] = ['equal', 'exact', 'percent', 'shares'];
const plain = (amount: Paise) => formatRupees(amount, { symbol: false }).replace(/,/g, '');

/** A typed value as the number splitAmount takes, or NaN when it isn't one. */
function partValue(method: SplitMethod, text: string): number {
  if (method === 'equal') return 0;
  if (method === 'exact') return parseRupees(text) ?? NaN;
  const n = Number(text.trim());
  if (!text.trim() || !Number.isFinite(n) || n < 0) return NaN;
  return method === 'percent' ? Math.round(n * 100) : Math.round(n);
}

function splitError(error: Exclude<ReturnType<typeof splitAmount>, { shares: unknown }>['error']): string {
  switch (error.code) {
    case 'no_parts':
      return 'Add at least one person';
    case 'bad_value':
      return 'Enter a number for everyone';
    case 'exact_mismatch':
      return error.difference > 0 ? `${formatAmount(error.difference)} is not given to anyone yet` : `That is ${formatAmount(-error.difference)} too much`;
    case 'percent_mismatch':
      return `The percentages add up to ${error.total / 100}%, not 100%`;
  }
}

/** SPL-1: split a payment the user made among people, equally, by amounts, percentages or shares. */
export default function SplitEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [total, setTotal] = useState<Paise | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [includeMe, setIncludeMe] = useState(true);
  const [members, setMembers] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [isSplit, setIsSplit] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);

  useEffect(() => {
    (async () => {
      const [can, existing, categories] = await Promise.all([splittable(id), currentSplit(id), categoryNames()]);
      setNames(categories);
      setGroups(await listGroups());
      await reloadPeople();
      if (!can) return setError('Only money you paid out can be split');
      setTotal(can.total);
      setCategoryId(existing?.categoryId ?? can.categoryId);
      if (existing) {
        setIsSplit(true);
        setMethod('exact');
        setIncludeMe(existing.myShare > 0);
        setMembers([...existing.shares.keys()]);
        setValues(Object.fromEntries([[ME, plain(existing.myShare)], ...[...existing.shares].map(([k, v]) => [k, plain(v)])]));
      }
    })();
  }, [id, reloadPeople]);

  const participants = [...(includeMe ? [ME] : []), ...members];
  const parts: SplitPart[] = participants.map((p) => ({ id: p, value: partValue(method, values[p] ?? '') }));
  const result = total === null ? null : splitAmount(total, method, parts);
  const nameOf = (pid: string) => (pid === ME ? 'You' : (people.find((p) => p.account.id === pid)?.account.name ?? 'Someone'));

  const toggle = (pid: string) => setMembers((m) => (m.includes(pid) ? m.filter((x) => x !== pid) : [...m, pid]));
  const addGroup = (g: SplitGroup) => setMembers((m) => [...new Set([...m, ...g.memberIds])]);

  async function save() {
    if (!result || 'error' in result) return setError(result ? splitError(result.error) : 'Entry not found');
    if (!categoryId) return setError('Pick a category for your share');
    if (dueDate.trim() && !isDateKey(dueDate.trim())) return setError('Enter the due date as YYYY-MM-DD, or leave it empty');
    const myShare = result.shares.get(ME) ?? (0 as Paise);
    const shares = new Map([...result.shares].filter(([k]) => k !== ME));
    setSaving(true);
    try {
      await splitEntry(id, { categoryId, myShare, shares, dueDate: dueDate.trim() || null });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (total === null) return <View style={styles.container}>{error && <ErrorText>{error}</ErrorText>}</View>;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.total}>{formatAmount(total)}</Text>
      <Text style={styles.label}>Split with</Text>
      <PersonPicker people={people} selected={members} onToggle={toggle} onCreated={(pid) => reloadPeople().then(() => toggle(pid))} />
      {groups.length > 0 && (
        <>
          <Text style={styles.label}>Add a group</Text>
          <Chips>
            {groups.map((g) => (
              <Chip key={g.id} label={g.name} selected={g.memberIds.length > 0 && g.memberIds.every((m) => members.includes(m))} onPress={() => addGroup(g)} />
            ))}
          </Chips>
        </>
      )}
      <Chips>
        <Chip label="Include my share" selected={includeMe} onPress={() => setIncludeMe(!includeMe)} />
      </Chips>

      <Text style={styles.label}>How</Text>
      <Chips>
        {METHODS.map((m) => (
          <Chip key={m} label={SPLIT_METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </Chips>

      {participants.length > 0 && (
        <Card style={styles.parts}>
          {participants.map((pid) => (
            <View key={pid} style={styles.part}>
              <Text style={styles.partName} numberOfLines={1}>
                {nameOf(pid)}
              </Text>
              {method !== 'equal' && (
                <TextInput
                  value={values[pid] ?? ''}
                  onChangeText={(text) => setValues((v) => ({ ...v, [pid]: text }))}
                  keyboardType="decimal-pad"
                  placeholder={method === 'exact' ? '₹' : method === 'percent' ? '%' : 'shares'}
                  placeholderTextColor={colors.muted}
                  style={styles.partInput}
                />
              )}
              <Text style={styles.partShare}>{result && 'shares' in result ? formatAmount(result.shares.get(pid) ?? 0) : '–'}</Text>
            </View>
          ))}
        </Card>
      )}
      {result && 'error' in result && participants.length > 0 && <Text style={styles.hint}>{splitError(result.error)}</Text>}

      <Text style={styles.label}>Your share counts toward</Text>
      <Chips>
        <Chip label={categoryId ? (names.get(categoryId) ?? 'Category') : 'Pick a category'} selected={categoryId !== null} onPress={() => setPicking(true)} />
      </Chips>
      <DateField label="Ask them to pay back by" value={dueDate || null} onChange={(key) => setDueDate(key ?? '')} optional placeholder="No date" style={styles.date} />
      <Text style={styles.hint}>Each person gets an IOU for their share. When they pay you by UPI, the bank SMS settles it.</Text>

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={isSplit ? 'Save split' : 'Split'} onPress={save} loading={saving} />
        {isSplit && (
          <Pressable
            accessibilityRole="button"
            style={styles.remove}
            onPress={() =>
              Alert.alert('Undo this split?', 'The whole amount counts as your spending again, and the IOUs for it are removed.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Undo split',
                  style: 'destructive',
                  onPress: () => unsplit(id).then(() => router.back(), (e) => setError(e instanceof Error ? e.message : String(e))),
                },
              ])
            }
          >
            <Text style={styles.removeText}>Undo split</Text>
          </Pressable>
        )}
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
  total: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: -1, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  date: { marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  parts: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 4 },
  part: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  partName: { flex: 1, fontSize: 15, color: colors.text },
  partInput: {
    width: 90,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    fontSize: 15,
    color: colors.text,
    textAlign: 'right',
  },
  partShare: { width: 90, textAlign: 'right', fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { marginTop: 24, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
