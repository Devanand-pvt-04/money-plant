import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import {
  CADENCES,
  CADENCE_LABELS,
  dateOf,
  daysBetween,
  currencyInfo,
  formatMoney,
  isDateKey,
  nextOccurrence,
  paise,
  parseMoney,
  type Cadence,
} from '@money-plant/core';
import type { RecurringPayment } from '@money-plant/matcher';
import { FormScroll } from '@/components/keyboard';
import { CategoryPicker } from '@/components/category-picker';
import { DateField } from '@/components/date-fields';
import { AccountPicker } from '@/components/account-picker';
import { formatAmount, formatDate, formatDateTime } from '@/components/format';
import { Button, Card, Chip, Chips, ErrorText, Field, MoneyCard, figures, useColors, makeStyles } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { homeCurrency } from '@/lib/home-currency';
import { getTransaction, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { closeOccurrence, deleteRecurring, dueLabel, getRecurring, saveRecurring, setRecurringStatus, today } from '@/lib/recurring';

const ORIGIN_LABELS: Record<RecurringPayment['origin'], string> = {
  manual: 'You added this',
  history: 'Found in your payment history',
  pre_debit: "Found in your bank's autopay notice",
};

/** REC-2: add or edit a recurring payment. `/recurring/new?from=<entry id>` starts from an existing entry. */
export default function RecurringDetail() {
  const colors = useColors();
  const styles = useStyles();
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
  const [editing, setEditing] = useState(isNew);
  const [pickingAccount, setPickingAccount] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: isNew ? 'Add recurring payment' : editing ? 'Edit recurring payment' : 'Recurring payment',
      headerRight:
        isNew || editing
          ? undefined
          : () => (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit" hitSlop={8} onPress={() => setEditing(true)} style={styles.headerButton}>
                <Feather name="edit-2" size={18} color={colors.text} />
              </Pressable>
            ),
    });
  }, [navigation, isNew, editing, colors, styles]);

  useEffect(() => {
    (async () => {
      const [balances, categories] = await Promise.all([listAccountBalances(), categoryNames()]);
      setAccounts(balances);
      setNames(categories);
      if (!isNew) {
        const loaded = await getRecurring(id);
        if (!loaded) return;
        setItem(loaded);
        setName(loaded.name);
        setAmount(formatMoney(loaded.amount, loaded.currency ?? homeCurrency(), { symbol: false }).replace(/,/g, ''));
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
          setAmount(formatMoney(paise(Math.abs(own.amount)), own.currency, { symbol: false }).replace(/,/g, ''));
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
  }, [id, from, isNew]);

  // In the paying account's currency; with no account, the payment's own, else the home currency (decision 0017).
  const currency = accounts.find((b) => b.account.id === accountId)?.currency ?? (accountId === null ? item?.currency : undefined) ?? homeCurrency();

  async function save() {
    const typed = parseMoney(amount, currency);
    const parsed = typed === null ? null : paise(typed);
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
        currency,
      });
      if (isNew) return router.back();
      const saved = await getRecurring(id);
      if (saved) setItem(saved);
      setSaving(false);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const act = (work: () => Promise<void>) => () => work().then(() => router.back(), (e) => setError(String(e?.message ?? e)));

  const remove = () =>
    item &&
    Alert.alert('Delete this recurring payment?', 'Its reminders stop. Past entries stay in your ledger.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: act(() => deleteRecurring(item.id)) },
    ]);

  // Decision 0028: an existing payment opens on a money card with shortcuts; the form sits behind the pencil.
  if (item && !editing) {
    const accountName = accounts.find((b) => b.account.id === item.accountId)?.account.name ?? null;
    const shortcuts: { icon: ComponentProps<typeof Feather>['name']; label: string; onPress: () => void }[] =
      item.status === 'active'
        ? [
            { icon: 'check', label: 'I paid this one', onPress: act(() => closeOccurrence(item.id, 'paid')) },
            { icon: 'skip-forward', label: 'Skip this one', onPress: act(() => closeOccurrence(item.id, 'skipped')) },
            { icon: 'pause', label: 'Pause', onPress: act(() => setRecurringStatus(item.id, 'paused')) },
          ]
        : [{ icon: 'play', label: item.status === 'paused' ? 'Resume' : 'Track it', onPress: act(() => setRecurringStatus(item.id, 'active')) }];
    return (
      <ScrollView contentContainerStyle={styles.view}>
        <MoneyCard>
          <View>
            <Text style={styles.heroLabel}>{item.name}</Text>
            <Text style={styles.heroValue}>{formatAmount(item.amount, item.currency ?? homeCurrency())}</Text>
            <Text style={styles.heroNote}>
              {CADENCE_LABELS[item.cadence]}
              {item.status === 'active'
                ? ` · next ${formatDate(`${item.nextDue}T12:00:00`)} (${dueLabel(daysBetween(today(), item.nextDue)).toLowerCase()})`
                : item.status === 'paused'
                  ? ' · paused, no reminders'
                  : item.status === 'proposed'
                    ? ' · suggested, not tracked yet'
                    : ' · you said this is not recurring'}
            </Text>
          </View>
          <View style={styles.heroLine} />
          <View style={styles.shortcuts}>
            {shortcuts.map((sc) => (
              <Pressable key={sc.label} accessibilityRole="button" onPress={sc.onPress} style={({ pressed }) => [styles.shortcut, pressed && styles.pressedFade]}>
                <View style={styles.shortcutIcon}>
                  <Feather name={sc.icon} size={18} color={colors.heroAccent} />
                </View>
                <Text style={styles.shortcutLabel} numberOfLines={1}>
                  {sc.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </MoneyCard>
        {error && <ErrorText>{error}</ErrorText>}
        <Card>
          <DetailRow label="Paid from" value={accountName ?? 'Not sure'} first onPress={() => setEditing(true)} />
          <DetailRow label="Payee in bank SMS" value={item.vpa ?? item.merchant ?? 'None'} onPress={() => setEditing(true)} />
          <DetailRow label="Category" value={item.categoryId ? (names.get(item.categoryId) ?? 'Category') : 'None'} onPress={() => setEditing(true)} />
          <DetailRow
            label={ORIGIN_LABELS[item.origin]}
            value={item.lastPaidAt ? `Last paid ${formatDateTime(item.lastPaidAt)}` : 'Not seen paid yet'}
            onPress={item.lastTransactionId ? () => router.push(`/transaction/${item.lastTransactionId}`) : undefined}
          />
        </Card>
        <Pressable accessibilityRole="button" style={styles.remove} onPress={remove}>
          <Text style={styles.removeText}>Delete</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Rent, Netflix, Car EMI" maxLength={80} />
      <Field label={`Amount (${currencyInfo(currency).symbol.trim()})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Text style={styles.label}>How often</Text>
      <Chips>
        {CADENCES.map((c) => (
          <Chip key={c} label={CADENCE_LABELS[c]} selected={cadence === c} onPress={() => setCadence(c)} />
        ))}
      </Chips>
      <DateField label="Next due date" value={nextDue} onChange={(key) => key && setNextDue(key)} style={styles.date} />

      <Text style={styles.label}>Paid from</Text>
      <Chips>
        <Chip label={accounts.find((b) => b.account.id === accountId)?.account.name ?? 'Pick an account'} selected={accountId !== null} onPress={() => setPickingAccount(true)} />
        {accountId && <Chip label="Not sure" selected={false} onPress={() => setAccountId(null)} />}
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
        {!isNew && <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />}
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
      <AccountPicker
        visible={pickingAccount}
        title="Paid from"
        onClose={() => setPickingAccount(false)}
        onPick={(b) => {
          setAccountId(b.account.id);
          setPickingAccount(false);
        }}
      />
    </FormScroll>
  );
}

/** One line of the payment's details; tapping it opens the form (or the last payment). */
function DetailRow({ label, value, first, onPress }: { label: string; value: string; first?: boolean; onPress?: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.detail, !first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {onPress && <Feather name="chevron-right" size={18} color={colors.muted} />}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  view: { padding: 16, paddingBottom: 48, gap: 16 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { fontSize: 13, fontWeight: '500', color: colors.heroMuted },
  heroValue: { fontSize: 34, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroNote: { fontSize: 13, color: colors.heroMuted, marginTop: 2 },
  heroLine: { height: 1, backgroundColor: colors.heroLine },
  shortcuts: { flexDirection: 'row' },
  shortcut: { flex: 1, alignItems: 'center', gap: 6 },
  shortcutIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.heroPill, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { fontSize: 12, fontWeight: '500', color: colors.heroText },
  pressedFade: { opacity: 0.7 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  detailLabel: { fontSize: 12, color: colors.muted },
  detailValue: { fontSize: 15, fontWeight: '500', color: colors.text, marginTop: 2 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  date: { marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
}));
