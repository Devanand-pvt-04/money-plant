import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { currencyInfo, dateKey, formatMoney, paise, parseMoney, type CurrencyCode, type DateKey } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { DateField } from '@/components/date-fields';
import { formatAmount, formatDate } from '@/components/format';
import { FormScroll } from '@/components/keyboard';
import { Button, Chip, Chips, ErrorText, Field, Initial, SectionTitle, radius, useColors, makeStyles } from '@/components/ui';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { getPerson, type Person } from '@/lib/people';
import { createItem, entriesFitting, getItem, type ItemFlow } from '@/lib/shared';

type How = 'bank' | 'account' | 'outside';

/**
 * Settle up with someone (decision 0027): how much, and how it was paid. A
 * payment in the user's bank is linked, cash or another account gets a typed
 * entry, and "settled another way" moves no money in any account: the
 * person's balance goes to zero against the hidden settled account. Each way
 * records a repayment item, which a friend sees too.
 * `?person=<id>` settles their balance; `&item=<id>` starts from one item.
 */
export default function SettleUp() {
  const colors = useColors();
  const styles = useStyles();
  const params = useLocalSearchParams<{ person: string; item?: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [flow, setFlow] = useState<ItemFlow>('to_me');
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState<DateKey>(() => dateKey(new Date()));
  const [how, setHow] = useState<How | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LedgerTransaction[]>([]);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [found, item, all] = await Promise.all([getPerson(params.person), params.item ? getItem(params.item) : null, listAccountBalances()]);
      setPerson(found);
      setAccounts(all.filter((b) => b.account.type !== 'loan' && b.account.type !== 'credit_card'));
      let start: { amount: number; currency: CurrencyCode } | null = null;
      if (item) {
        // Settling what an item left owed: they pay back what was lent to them, or the user pays back.
        setFlow(item.flow === 'to_them' ? 'to_me' : 'to_them');
        start = { amount: item.amount, currency: item.currency };
      } else if (found?.balances[0]) {
        const b = found.balances[0];
        setFlow(b.amount > 0 ? 'to_me' : 'to_them');
        start = { amount: Math.abs(b.amount), currency: b.currency };
      }
      if (start) {
        setCurrency(start.currency);
        setAmount(formatMoney(paise(start.amount), start.currency, { symbol: false }).replace(/,/g, ''));
      }
    })();
  }, [params.person, params.item]);

  const typed = parseMoney(amount, currency);
  const value = typed === null ? null : paise(typed);
  const name = person?.account.name ?? 'them';
  const owed = person?.balances.find((b) => b.currency === currency);
  const inCurrency = accounts.filter((b) => b.currency === currency).sort((a, b) => Number(b.account.type === 'cash') - Number(a.account.type === 'cash'));

  // Payments in the user's accounts that could be this one.
  useEffect(() => {
    if (!person || value === null || value <= 0) return setCandidates([]);
    let live = true;
    entriesFitting({ kind: 'repayment', flow, amount: value, occurredOn, personId: person.account.id }).then((found) => {
      if (!live) return;
      setCandidates(found.slice(0, 4));
      setEntryId((now) => (now && found.some((t) => t.id === now) ? now : null));
    });
    return () => {
      live = false;
    };
  }, [person, value, flow, occurredOn]);

  async function save() {
    setError(null);
    if (!person) return;
    if (value === null || value <= 0) return setError('Enter the amount as a number above zero');
    if (!how) return setError('Pick how it was paid');
    if (how === 'bank' && !entryId) return setError('Pick the payment, or choose another way');
    if (how === 'account' && !accountId) return setError('Pick the account');
    setSaving(true);
    try {
      const side =
        how === 'bank'
          ? { transactionId: entryId! }
          : how === 'account'
            ? { accountId: accountId!, occurredAt: new Date(`${occurredOn}T12:00:00`).toISOString() }
            : ({ outside: true } as const);
      const id = await createItem({ personId: person.account.id, kind: 'repayment', flow, amount: value, occurredOn, reason: reason.trim() || null }, side);
      router.replace(`/item/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const option = (key: How, icon: ComponentProps<typeof Feather>['name'], title: string, body: string) => {
    const on = how === key;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        onPress={() => setHow(key)}
        style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
      >
        <View style={[styles.optionIcon, on && styles.optionIconOn]}>
          <Feather name={icon} size={18} color={on ? colors.onInk : colors.primary} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionBody}>{body}</Text>
        </View>
      </Pressable>
    );
  };

  const toMe = flow === 'to_me';
  const amountText = value !== null && value > 0 ? formatAmount(value, currency) : 'it';

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Initial name={name} size={56} />
        <Text style={styles.title}>Settle up with {name}</Text>
        <Text style={styles.meta}>
          {owed ? (owed.amount > 0 ? `${name} owes you ${formatAmount(owed.amount, currency)}` : `You owe ${name} ${formatAmount(-owed.amount, currency)}`) : 'Nothing open between you'}
        </Text>
      </View>

      <Chips>
        <Chip label={`${name} paid me`} selected={toMe} onPress={() => setFlow('to_me')} />
        <Chip label={`I paid ${name}`} selected={!toMe} onPress={() => setFlow('to_them')} />
      </Chips>
      <Field label={`Amount (${currencyInfo(currency).symbol.trim()})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Text style={styles.hint}>Change it for a part payment.</Text>
      <DateField label="When" value={occurredOn} onChange={(key) => key && setOccurredOn(key)} style={styles.date} />

      <SectionTitle>How was it paid?</SectionTitle>
      <View style={styles.options}>
        {option(
          'bank',
          'credit-card',
          toMe ? 'It came into my bank' : 'It went from my bank',
          candidates.length > 0
            ? `Link the payment, so it isn't counted twice. ${candidates.length === 1 ? '1 payment fits' : `${candidates.length} payments fit`}.`
            : 'Link the payment when it shows up. None of this amount from the last 3 days yet.',
        )}
        {how === 'bank' && candidates.length > 0 && (
          <Chips>
            {candidates.map((tx) => (
              <Chip key={tx.id} label={`${tx.counterparty ?? 'Payment'}, ${formatDate(tx.occurredAt)}`} selected={entryId === tx.id} onPress={() => setEntryId(tx.id)} />
            ))}
          </Chips>
        )}
        {option('account', 'dollar-sign', 'Cash or another account', `Adds ${amountText} ${toMe ? 'to' : 'from'} the account you pick.`)}
        {how === 'account' &&
          (inCurrency.length > 0 ? (
            <Chips>
              {inCurrency.map((b) => (
                <Chip key={b.account.id} label={b.account.name} selected={accountId === b.account.id} onPress={() => setAccountId(b.account.id)} />
              ))}
            </Chips>
          ) : (
            <Text style={styles.hint}>Add a Cash account in Money first.</Text>
          ))}
        {option('outside', 'check-circle', 'Settled another way', `No money moves in any account. For “we're even”, paid in kind, or let go.`)}
      </View>
      {how === 'outside' && (
        <Text style={styles.hint}>
          {name}'s balance goes down by {amountText}. Your accounts, spending and budgets stay the same; net worth {toMe ? 'drops' : 'rises'} by it, because{' '}
          {toMe ? "that money isn't coming" : "you won't pay it"}.
          {person?.account.email ? ` ${name} sees it as settled too.` : ''} You can remove it later if it was a mistake.
        </Text>
      )}
      <Field label="Note" value={reason} onChangeText={setReason} placeholder={how === 'outside' ? 'They paid for my movie ticket' : 'Optional'} maxLength={120} />

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={value !== null && value > 0 ? `Mark ${formatAmount(value, currency)} as settled` : 'Mark as settled'} onPress={save} loading={saving} disabled={!how} />
      </View>
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 16 },
  title: { fontSize: 19, fontWeight: '700', color: colors.text, marginTop: 8 },
  meta: { fontSize: 13, color: colors.muted },
  hint: { fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 17 },
  date: { marginTop: 16 },
  options: { gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionOn: { borderColor: colors.ink, borderWidth: 2, padding: 13 },
  pressed: { opacity: 0.7 },
  optionIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  optionIconOn: { backgroundColor: colors.ink },
  grow: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  optionBody: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
  actions: { marginTop: 24, gap: 10 },
}));
