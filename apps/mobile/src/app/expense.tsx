import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { SPLIT_METHOD_LABELS, formatRupees, parseRupees, splitAmount, type Paise, type SplitMethod, type SplitPart } from '@money-plant/core';
import { AccountPicker, accountLabel } from '@/components/account-picker';
import { CategoryPicker } from '@/components/category-picker';
import { formatAmount } from '@/components/format';
import { Sheet } from '@/components/sheet';
import { Button, ErrorText, Initial, colors, radius } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { getTransaction, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { createPerson, listPeople, type Person } from '@/lib/people';
import { addExpense, currentSplit, listGroups, splittable, unsplit, type SplitGroup } from '@/lib/splits';

const ME = 'me';
const METHODS: SplitMethod[] = ['equal', 'exact', 'percent', 'shares'];
const plain = (amount: Paise) => formatRupees(amount, { symbol: false }).replace(/,/g, '').replace(/\.00$/, '');
const short = (amount: number) => formatAmount(amount).replace(/\.00$/, '');

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
      return 'Tick at least one person';
    case 'bad_value':
      return 'Enter a number for everyone ticked';
    case 'exact_mismatch':
      return error.difference > 0 ? `${short(error.difference)} isn't given to anyone yet` : `That's ${short(-error.difference)} too much`;
    case 'percent_mismatch':
      return `The percentages add up to ${error.total / 100}%, not 100%`;
  }
}

/** "Rahul", "Rahul and Ananya", "Rahul, Ananya and Karthik". */
function names(list: readonly string[]): string {
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * SPL-1 and SPL-3: one sheet for an expense with people. The user or someone
 * else paid; tick who shares it and how. Opened with `from` to split an entry
 * the user already has, `group` from inside a group, or `person` from a
 * person's page.
 */
export default function Expense() {
  const params = useLocalSearchParams<{ from?: string; group?: string; person?: string }>();
  const from = params.from ?? null;
  const [people, setPeople] = useState<Person[]>([]);
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [fixedTotal, setFixedTotal] = useState<Paise | null>(null);
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [paidBy, setPaidBy] = useState(ME);
  const [groupId, setGroupId] = useState<string | null>(params.group ?? null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [ticked, setTicked] = useState<string[]>([ME, ...(params.person ? [params.person] : [])]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isSplit, setIsSplit] = useState(false);
  const [picking, setPicking] = useState<'payer' | 'group' | 'account' | 'category' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);

  useEffect(() => {
    (async () => {
      const [allGroups, balances, cats] = await Promise.all([listGroups(), listAccountBalances(), categoryNames(), reloadPeople()]);
      setGroups(allGroups);
      setCategories(cats);
      const usable = balances.filter((b) => !b.liability || b.account.type === 'credit_card');
      setAccounts(usable);
      setAccountId((usable.find((b) => b.account.type === 'bank') ?? usable[0])?.account.id ?? null);
      if (params.group) {
        const group = allGroups.find((g) => g.id === params.group);
        if (group) setTicked([ME, ...group.memberIds]);
      }
      if (!from) return;
      const [can, existing, row] = await Promise.all([splittable(from), currentSplit(from), getTransaction(from)]);
      if (!can) return setError('Only money you paid out can be split');
      setFixedTotal(can.total);
      setCategoryId(existing?.categoryId ?? can.categoryId);
      setWhat(row?.tx.counterparty ?? '');
      if (row?.tx.splitGroupId) setGroupId(row.tx.splitGroupId);
      if (existing) {
        setIsSplit(true);
        setMethod('exact');
        setTicked([...(existing.myShare > 0 ? [ME] : []), ...existing.shares.keys()]);
        setValues(Object.fromEntries([[ME, plain(existing.myShare)], ...[...existing.shares].map(([k, v]) => [k, plain(v)])]));
      }
    })();
  }, [from, params.group, reloadPeople]);

  const group = groups.find((g) => g.id === groupId) ?? null;
  const total = fixedTotal ?? parseRupees(amount || '0');
  const nameOf = (id: string) => (id === ME ? 'You' : (people.find((p) => p.account.id === id)?.account.name ?? 'Someone'));
  const firstName = (id: string) => nameOf(id).split(' ')[0]!;

  // You, then the group's people (or everyone ticked), then the rest; a search narrows it.
  const rows = useMemo(() => {
    const inGroup = new Set(group?.memberIds ?? []);
    const others = people
      .map((p) => p.account.id)
      .sort((a, b) => Number(inGroup.has(b) || ticked.includes(b)) - Number(inGroup.has(a) || ticked.includes(a)));
    const all = [ME, ...others];
    const q = query.trim().toLowerCase();
    return q ? all.filter((id) => nameOf(id).toLowerCase().includes(q)) : all;
    // nameOf reads people, listed here.
  }, [people, group, ticked, query]);

  const parts: SplitPart[] = ticked.map((id) => ({ id, value: partValue(method, values[id] ?? '') }));
  const result = total ? splitAmount(total, method, parts) : null;
  const shares = result && 'shares' in result ? result.shares : null;

  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  async function addPerson() {
    try {
      const id = await createPerson({ name: query });
      await reloadPeople();
      setTicked((t) => [...t, id]);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function summary(): string {
    if (!shares) return '';
    const myShare = shares.get(ME) ?? 0;
    const category = categoryId ? (categories.get(categoryId) ?? 'your category') : null;
    const counts = myShare > 0 && category ? ` Your ${short(myShare)} counts as ${category}.` : '';
    if (paidBy !== ME) return myShare > 0 ? `You owe ${firstName(paidBy)} ${short(myShare)}.${counts}` : "You aren't ticked, so you don't owe anything.";
    const owing = ticked.filter((id) => id !== ME && (shares.get(id) ?? 0) > 0);
    if (owing.length === 0) return 'Tick the people who share it.';
    const amounts = new Set(owing.map((id) => shares.get(id)));
    const who = amounts.size === 1
      ? `${names(owing.map(firstName))} ${owing.length === 1 ? 'owes' : 'each owe'} you ${short(shares.get(owing[0]!)!)}.`
      : `${owing.map((id) => `${firstName(id)} owes you ${short(shares.get(id)!)}`).join(', ')}.`;
    return who + counts;
  }

  async function save() {
    if (!total) return setError('Enter the amount');
    if (!result || 'error' in result) return setError(result ? splitError(result.error) : 'Enter the amount');
    const myShare = shares!.get(ME) ?? (0 as Paise);
    if (!categoryId && myShare > 0) return setError('Pick what your share counts as');
    setSaving(true);
    setError(null);
    try {
      await addExpense({
        total,
        what: what.trim() || null,
        paidBy,
        accountId,
        fromEntry: from,
        groupId,
        categoryId: categoryId ?? '',
        myShare,
        shares: new Map([...shares!].filter(([id]) => id !== ME && id !== paidBy)),
        occurredAt: new Date().toISOString(),
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const account = accounts.find((b) => b.account.id === accountId);
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.amountRow}>
        {fixedTotal !== null ? (
          <Text style={styles.amount}>{short(fixedTotal)}</Text>
        ) : (
          <>
            <Text style={styles.rupee}>₹</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              autoFocus
              accessibilityLabel="Amount"
              style={[styles.amount, styles.amountInput]}
            />
          </>
        )}
      </View>
      <TextInput
        value={what}
        onChangeText={setWhat}
        placeholder="What was it? Dinner, cab, rent"
        placeholderTextColor={colors.placeholder}
        maxLength={80}
        accessibilityLabel="What was it"
        style={styles.what}
      />

      <View style={styles.tiles}>
        <Tile label="Paid by" value={paidBy === ME ? 'You' : nameOf(paidBy)} disabled={from !== null} onPress={() => setPicking('payer')} />
        <Tile label="Group" value={group?.name ?? 'None'} onPress={() => setPicking('group')} />
      </View>
      {paidBy === ME && from === null && (
        <Tile label="Paid from" value={account ? accountLabel(account.account) : 'Pick an account'} onPress={() => setPicking('account')} />
      )}

      <Text style={styles.label}>How to split</Text>
      <View style={styles.segment}>
        {METHODS.map((m) => (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ selected: method === m }}
            onPress={() => setMethod(m)}
            style={[styles.segmentItem, method === m && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, method === m && styles.segmentTextOn]}>{SPLIT_METHOD_LABELS[m]}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.list}>
        <View style={styles.search}>
          <Feather name="search" size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Split with… search people"
            placeholderTextColor={colors.placeholder}
            autoCorrect={false}
            accessibilityLabel="Search people"
            style={styles.searchInput}
          />
        </View>
        {rows.map((id) => {
          const on = ticked.includes(id);
          return (
            <View key={id} style={styles.person}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={nameOf(id)}
                onPress={() => toggle(id)}
                style={styles.personTap}
              >
                <View style={[styles.box, on && styles.boxOn]}>{on && <Feather name="check" size={14} color={colors.onInk} />}</View>
                <Initial name={id === ME ? 'Me' : nameOf(id)} size={34} />
                <Text style={styles.personName} numberOfLines={1}>
                  {nameOf(id)}
                </Text>
              </Pressable>
              {on && method !== 'equal' && (
                <TextInput
                  value={values[id] ?? ''}
                  onChangeText={(text) => setValues((v) => ({ ...v, [id]: text }))}
                  keyboardType="decimal-pad"
                  placeholder={method === 'exact' ? '₹' : method === 'percent' ? '%' : 'units'}
                  placeholderTextColor={colors.placeholder}
                  accessibilityLabel={`${nameOf(id)}'s ${method === 'exact' ? 'amount' : method === 'percent' ? 'percent' : 'units'}`}
                  style={styles.partInput}
                />
              )}
              <Text style={[styles.share, !on && styles.muted]}>{on && shares ? short(shares.get(id) ?? 0) : '—'}</Text>
            </View>
          );
        })}
        {query.trim() !== '' && !people.some((p) => p.account.name.toLowerCase() === query.trim().toLowerCase()) && (
          <Pressable accessibilityRole="button" onPress={addPerson} style={styles.person}>
            <Feather name="user-plus" size={18} color={colors.primary} />
            <Text style={styles.addText}>Add "{query.trim()}" as a new person</Text>
          </Pressable>
        )}
      </View>

      {result && 'error' in result && ticked.length > 0 ? <Text style={styles.hint}>{splitError(result.error)}</Text> : null}
      {shares && (
        <Text style={styles.hint}>
          {summary()}{' '}
          {(shares.get(ME) ?? 0) > 0 && (
            <Text style={styles.link} onPress={() => setPicking('category')}>
              {categoryId ? 'Change' : 'Pick what it counts as'}
            </Text>
          )}
        </Text>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={isSplit ? 'Save changes' : 'Save expense'} onPress={save} loading={saving} />
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
                  onPress: () => unsplit(from!).then(() => router.back(), (e) => setError(e instanceof Error ? e.message : String(e))),
                },
              ])
            }
          >
            <Text style={styles.removeText}>Undo split</Text>
          </Pressable>
        )}
      </View>

      <Sheet visible={picking === 'payer'} onClose={() => setPicking(null)} title="Who paid?" tall>
        <ScrollView keyboardShouldPersistTaps="handled">
          {[ME, ...(group ? group.memberIds : people.map((p) => p.account.id))].map((id) => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ selected: paidBy === id }}
              onPress={() => {
                setPaidBy(id);
                if (!ticked.includes(ME)) setTicked((t) => [ME, ...t]);
                setPicking(null);
              }}
              style={styles.option}
            >
              <Initial name={id === ME ? 'Me' : nameOf(id)} size={34} />
              <Text style={styles.personName}>{nameOf(id)}</Text>
              {paidBy === id && <Feather name="check" size={18} color={colors.primary} />}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
      <Sheet visible={picking === 'group'} onClose={() => setPicking(null)} title="Add to a group">
        {[null, ...groups].map((g) => (
          <Pressable
            key={g?.id ?? 'none'}
            accessibilityRole="radio"
            accessibilityState={{ selected: groupId === (g?.id ?? null) }}
            onPress={() => {
              setGroupId(g?.id ?? null);
              if (g) setTicked((t) => [...new Set([...t, ...g.memberIds])]);
              setPicking(null);
            }}
            style={styles.option}
          >
            <Text style={styles.personName}>{g ? g.name : 'No group'}</Text>
            {groupId === (g?.id ?? null) && <Feather name="check" size={18} color={colors.primary} />}
          </Pressable>
        ))}
      </Sheet>
      <AccountPicker
        visible={picking === 'account'}
        title="Paid from"
        onPick={(b) => {
          setAccountId(b.account.id);
          setAccounts((list) => (list.some((x) => x.account.id === b.account.id) ? list : [...list, b]));
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <CategoryPicker
        visible={picking === 'category'}
        flow="expense"
        title="Your share counts as"
        onPick={(category) => {
          setCategoryId(category.id);
          setCategories(new Map(categories).set(category.id, category.name));
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </ScrollView>
  );
}

function Tile(props: { label: string; value: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${props.value}`}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Text style={styles.tileLabel}>{props.label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>
        {props.value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  rupee: { fontSize: 40, fontWeight: '700', color: colors.muted },
  amount: { fontSize: 48, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], textAlign: 'center' },
  amountInput: { minWidth: 80, paddingVertical: 0 },
  what: { alignSelf: 'center', minWidth: 220, maxWidth: '100%', minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.subtle, fontSize: 14, color: colors.text, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 6 },
  tile: { flex: 1, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  pressed: { backgroundColor: colors.pressed },
  tileLabel: { fontSize: 12, color: colors.muted },
  tileValue: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 2 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 6 },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  personTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, minWidth: 0 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  personName: { flex: 1, fontSize: 15, color: colors.text },
  partInput: { width: 76, minHeight: 38, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, fontSize: 15, color: colors.text, textAlign: 'right' },
  share: { width: 76, textAlign: 'right', fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { color: colors.muted, fontWeight: '400' },
  addText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.primary },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  link: { color: colors.primary, fontWeight: '600' },
  actions: { marginTop: 12, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 4 },
});
