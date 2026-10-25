import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import {
  addMonthsToDate,
  dateKey,
  daysBetween,
  maturityValue,
  parseRupees,
  valueOn,
  type DateKey,
  type DepositKind,
  type DepositPayout,
  type DepositTerms,
} from '@money-plant/core';
import { AccountPicker, accountLabel } from '@/components/account-picker';
import { DateField } from '@/components/date-fields';
import { formatDay, formatWholeRupees as rupees } from '@/components/format';
import { Button, Chip, Chips, ErrorText, Field, colors, radius } from '@/components/ui';
import { getDeposit, saveDeposit, suggestPayee } from '@/lib/deposits';
import { listAccountBalances } from '@/lib/ledger';
import { requestNotificationPermission } from '@/lib/notifications';

const PAYOUTS: { value: DepositPayout; label: string }[] = [
  { value: 'reinvest', label: 'Added to the FD' },
  { value: 'monthly', label: 'Paid out monthly' },
  { value: 'quarterly', label: 'Paid out quarterly' },
];

/** "7.25" or "7.25%" to basis points, without floating point. */
function parseRate(text: string): number | null {
  const match = /^\s*(\d{1,2})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 3000 ? bp : null;
}
const rateText = (bp: number) => (bp / 100).toFixed(2).replace(/\.?0+$/, '');
const rupeeText = (amount: number) => String(amount / 100).replace(/\.0+$/, '');
const tenureMonths = (start: DateKey, maturity: DateKey) => {
  for (let m = 1; m <= 600; m++) if (addMonthsToDate(start, m) === maturity) return String(m);
  return '';
};

interface Payer {
  id: string;
  label: string;
}

/** NW-2: the terms of an FD or RD, from which the app works out interest, maturity and reminders. */
export default function DepositTermsScreen() {
  const params = useLocalSearchParams<{ account: string }>();
  const [kind, setKind] = useState<DepositKind | null>(null);
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [start, setStart] = useState<DateKey>(dateKey(new Date()));
  const [months, setMonths] = useState('12');
  const [maturity, setMaturity] = useState<DateKey>(addMonthsToDate(dateKey(new Date()), 12));
  const [payout, setPayout] = useState<DepositPayout>('reinvest');
  const [payer, setPayer] = useState<Payer | null>(null);
  const [payee, setPayee] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [existing, balances] = await Promise.all([getDeposit(params.account), listAccountBalances()]);
      const account = balances.find((b) => b.account.id === params.account)?.account;
      setKind(existing?.kind ?? (account?.type === 'rd' ? 'rd' : 'fd'));
      if (!existing) return;
      setAmount(rupeeText(existing.amountPaise));
      setRate(rateText(existing.rateBp));
      setStart(existing.startDate);
      setMaturity(existing.maturityDate);
      setMonths(tenureMonths(existing.startDate, existing.maturityDate));
      setPayout(existing.payout);
      setPayee(existing.payee ?? '');
      const from = balances.find((b) => b.account.id === existing.paidFromAccountId);
      if (from) setPayer({ id: from.account.id, label: accountLabel(from.account) });
    })();
  }, [params.account]);

  if (!kind) return null;
  const rd = kind === 'rd';
  const parsedAmount = parseRupees(amount);
  const rateBp = parseRate(rate);
  const terms: DepositTerms | null =
    parsedAmount !== null && parsedAmount > 0 && rateBp !== null && maturity > start
      ? { kind, amount: parsedAmount, rateBp, startDate: start, maturityDate: maturity, payout: rd ? 'reinvest' : payout }
      : null;

  function changeStart(key: DateKey) {
    setStart(key);
    const m = Number(months);
    if (m > 0) setMaturity(addMonthsToDate(key, m));
  }
  function changeMonths(text: string) {
    setMonths(text);
    const m = Number(text);
    if (Number.isInteger(m) && m > 0 && m <= 600) setMaturity(addMonthsToDate(start, m));
  }
  async function fillPayee() {
    if (payee.trim() !== '' || parsedAmount === null || parsedAmount <= 0) return;
    const seen = await suggestPayee(parsedAmount);
    if (seen) setPayee(seen);
  }

  async function save() {
    if (parsedAmount === null || parsedAmount <= 0) return setError(rd ? 'Enter the monthly instalment, for example 12,000' : 'Enter the amount deposited, for example 1,00,000');
    if (rateBp === null) return setError('Enter the interest rate as a number, for example 7.25');
    if (maturity <= start) return setError('The maturity date must be after the start date');
    setSaving(true);
    await saveDeposit({
      accountId: params.account,
      kind: rd ? 'rd' : 'fd',
      amount: parsedAmount,
      rateBp,
      startDate: start,
      maturityDate: maturity,
      payout: rd ? 'reinvest' : payout,
      paidFromAccountId: payer?.id ?? null,
      payee: payee.trim() || null,
    });
    await requestNotificationPermission();
    router.back();
  }

  const preview = terms && previewOf(terms);
  return (
    <>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Field
          label={rd ? 'Monthly instalment (₹)' : 'Amount deposited (₹)'}
          value={amount}
          onChangeText={setAmount}
          onBlur={fillPayee}
          keyboardType="decimal-pad"
          placeholder={rd ? '12,000' : '1,00,000'}
        />
        <Field label="Interest rate (% a year)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="7.25" />
        <DateField label={rd ? 'First instalment' : 'Start date'} value={start} onChange={(key) => key && changeStart(key)} />
        <Field label="Tenure (months)" value={months} onChangeText={changeMonths} keyboardType="number-pad" placeholder="12" />
        <DateField label="Matures on" value={maturity} min={start} onChange={(key) => key && setMaturity(key)} />

        {!rd && (
          <>
            <Text style={styles.label}>Interest</Text>
            <Chips>
              {PAYOUTS.map((p) => (
                <Chip key={p.value} label={p.label} selected={payout === p.value} onPress={() => setPayout(p.value)} />
              ))}
            </Chips>
          </>
        )}

        <Text style={styles.label}>{rd ? 'Instalments paid from' : 'Paid from'}</Text>
        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
          <Text style={[styles.pickerText, !payer && styles.placeholder]}>{payer?.label ?? 'Pick an account (optional)'}</Text>
          <Feather name="chevron-down" size={18} color={colors.muted} />
        </Pressable>
        <Field
          label={rd ? 'Payee on the instalment SMS' : 'Payee on the payment SMS (optional)'}
          value={payee}
          onChangeText={setPayee}
          autoCapitalize="characters"
          placeholder={rd ? 'SHIVALIK' : 'Leave empty to match any payee'}
          maxLength={80}
        />
        <Text style={styles.hint}>
          {rd
            ? 'Debits of the instalment to this payee become payments into this RD, so they stop counting as spending.'
            : 'A debit of this amount within 3 days of the start date becomes the payment into this FD.'}
        </Text>

        {preview && (
          <View style={styles.preview}>
            <Text style={styles.previewText}>{preview}</Text>
          </View>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <View style={styles.actions}>
          <Button title="Save" onPress={save} loading={saving} disabled={amount.trim() === '' || rate.trim() === ''} />
        </View>
      </ScrollView>
      <AccountPicker
        visible={picking}
        title={rd ? 'Instalments paid from' : 'Paid from'}
        exclude={[params.account]}
        onPick={(b) => {
          setPayer({ id: b.account.id, label: accountLabel(b.account) });
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </>
  );
}

function previewOf(terms: DepositTerms): string {
  const today = dateKey(new Date());
  const matures = `Matures on ${formatDay(`${terms.maturityDate}T12:00:00`)} at about ${rupees(maturityValue(terms))}.`;
  return daysBetween(terms.startDate, today) > 0 ? `${matures} Worth about ${rupees(valueOn(terms, today))} today.` : matures;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 4 },
  label: { fontSize: 14, color: colors.muted, marginTop: 12, marginBottom: 6 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.pressed },
  pickerText: { flex: 1, fontSize: 16, color: colors.text },
  placeholder: { color: colors.muted },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 4 },
  preview: { padding: 14, borderRadius: radius.md, backgroundColor: colors.subtle, marginTop: 12 },
  previewText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  actions: { marginTop: 20 },
});
