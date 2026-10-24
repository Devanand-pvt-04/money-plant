import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import {
  CADENCES,
  CADENCE_LABELS,
  dateOf,
  daysBetween,
  formatRupees,
  isDateKey,
  nextOccurrence,
  paise,
  parseRupees,
  type Cadence,
} from '@money-plant/core';
import type { RecurringPayment } from '@money-plant/matcher';
import { CategoryPicker } from '@/components/category-picker';
import { DateField } from '@/components/date-fields';
import { formatDate, formatDateTime } from '@/components/format';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { getTransaction, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { closeOccurrence, deleteRecurring, dueLabel, getRecurring, saveRecurring, setRecurringStatus, today } from '@/lib/recurring';

const ORIGIN_LABELS: Record<RecurringPayment['origin'], string> = {
  manual: 'You added this',
  history: 'Found in your payment history',
  pre_debit: "Found in your bank's autopay notice",
};

/** REC-2: add or edit a recurring payment. `/recurring/new?from=<entry id>` starts from an existing entry. */
export default function RecurringDetail() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';
  const [item, setItem] = useState<RecurringPayment | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [nextDue, setNextDue] = useState(today());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [payee, setPayee] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'Add recurring payment' : 'Recurring payment' });
    (async () => {
      const [balances, categories] = await Promise.all([listAccountBalances(), categoryNames()]);
      setAccounts(balances);
      setNames(categories);
      if (!isNew) {
        const loaded = await getRecurring(id);
        if (!loaded) return;
        setItem(loaded);
        setName(loaded.name);
        setAmount(formatRupees(loaded.amount, { symbol: false }).replace(/,/g, ''));
        setCadence(loaded.cadence);
        setNextDue(loaded.nextDue);
        setAccountId(loaded.accountId);
        setCategoryId(loaded.categoryId);
        setPayee(loaded.vpa ?? loaded.merchant ?? '');
      } else if (from) {
        const row = await getTransaction(from);
        if (!row) return;
        const own = row.legs[0];
        setName(row.tx.counterparty ?? '');
        if (own) {
          setAmount(formatRupees(paise(Math.abs(own.amount)), { symbol: false }).replace(/,/g, ''));
          setAccountId(own.accountId);
        }
        setCategoryId(row.category?.id ?? null);
        const vpa = row.tx.sources.find((s) => s.kind === 'sms')?.parsedFields.vpa;
        setPayee(typeof vpa === 'string' ? vpa : (row.tx.counterparty ?? ''));
        let due = nextOccurrence(dateOf(row.tx.occurredAt), 'monthly');
        while (daysBetween(today(), due) < 0) due = nextOccurrence(due, 'monthly');
        setNextDue(due);
      }
    })();
  }, [id, from, isNew, navigation]);

  async function save() {
    const parsed = parseRupees(amount);
    if (parsed === null || parsed <= 0) return setError('Enter the amount as a number above zero');
    if (!isDateKey(nextDue.trim())) return setError('Enter the next due date as YYYY-MM-DD, for example 2026-11-05');
    setSaving(true);
    try {
      await saveRecurring(isNew ? null : id, {
        name,
        amount: parsed,
        cadence,
        nextDue: nextDue.trim(),
        accountId,
        categoryId,
        payee: payee.trim() || null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const act = (work: () => Promise<void>) => () => work().then(() => router.back(), (e) => setError(String(e?.message ?? e)));

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {item && (
        <View style={styles.status}>
          <Text style={styles.statusTitle}>
            {item.status === 'active'
              ? `Next: ${formatDate(`${item.nextDue}T12:00:00`)} (${dueLabel(daysBetween(today(), item.nextDue)).toLowerCase()})`
              : item.status === 'paused'
                ? 'Paused: no reminders'
                : item.status === 'proposed'
                  ? 'Suggested: not tracked yet'
                  : 'You said this is not recurring'}
          </Text>
          <Text style={styles.meta}>
            {ORIGIN_LABELS[item.origin]}
            {item.lastPaidAt ? `. Last paid ${formatDateTime(item.lastPaidAt)}` : ''}
          </Text>
          {item.lastTransactionId && (
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push(`/transaction/${item.lastTransactionId}`)}>
              <Text style={styles.link}>See the last payment</Text>
            </Pressable>
          )}
        </View>
      )}

      <Field label="Name" value={name} onChangeText={setName} placeholder="Rent, Netflix, Car EMI" maxLength={80} />
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Text style={styles.label}>How often</Text>
      <Chips>
        {CADENCES.map((c) => (
          <Chip key={c} label={CADENCE_LABELS[c]} selected={cadence === c} onPress={() => setCadence(c)} />
        ))}
      </Chips>
      <DateField label="Next due date" value={nextDue} onChange={(key) => key && setNextDue(key)} style={styles.date} />

      <Text style={styles.label}>Paid from</Text>
      <Chips>
        <Chip label="Not sure" selected={accountId === null} onPress={() => setAccountId(null)} />
        {accounts.map((b) => (
          <Chip key={b.account.id} label={b.account.name} selected={accountId === b.account.id} onPress={() => setAccountId(b.account.id)} />
        ))}
      </Chips>
      <Text style={styles.hint}>With an account, the reminder warns you if it looks short.</Text>

      <Field
        label="Payee to look for in bank SMS"
        value={payee}
        onChangeText={setPayee}
        placeholder="NETFLIX or landlord@okicici"
        autoCapitalize="none"
      />
      <Text style={styles.hint}>A debit to this payee within 3 days of the due date, and within 10% of the amount, marks it paid.</Text>

      <Text style={styles.label}>Category</Text>
      <Chips>
        <Chip label={categoryId ? (names.get(categoryId) ?? 'Category') : 'None'} selected={categoryId !== null} onPress={() => setPicking(true)} />
        {categoryId && <Chip label="Clear" selected={false} onPress={() => setCategoryId(null)} />}
      </Chips>

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={isNew ? 'Add' : 'Save'} onPress={save} loading={saving} />
        {item?.status === 'active' && (
          <>
            <Button title="I paid this one" variant="secondary" onPress={act(() => closeOccurrence(item.id, 'paid'))} />
            <Button title="Skip this one" variant="secondary" onPress={act(() => closeOccurrence(item.id, 'skipped'))} />
            <Button title="Pause" variant="secondary" onPress={act(() => setRecurringStatus(item.id, 'paused'))} />
          </>
        )}
        {item && item.status !== 'active' && (
          <Button title={item.status === 'paused' ? 'Resume' : 'Track it'} variant="secondary" onPress={act(() => setRecurringStatus(item.id, 'active'))} />
        )}
        {item && (
          <Pressable
            accessibilityRole="button"
            style={styles.remove}
            onPress={() =>
              Alert.alert('Delete this recurring payment?', 'Its reminders stop. Past entries stay in your ledger.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: act(() => deleteRecurring(item.id)) },
              ])
            }
          >
            <Text style={styles.removeText}>Delete</Text>
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
  status: { padding: 16, borderRadius: 18, backgroundColor: colors.subtle, gap: 4 },
  statusTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  link: { fontSize: 13, fontWeight: '600', color: colors.primary, marginTop: 4 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  date: { marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
