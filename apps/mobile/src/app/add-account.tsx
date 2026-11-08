import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { ACCOUNT_TYPE_LABELS, LIABILITY_TYPES, USER_ACCOUNT_TYPES, currencyInfo, paise, parseMoney, type AccountType, type CurrencyCode } from '@money-plant/core';
import type { LocalAccountType } from '@money-plant/db-schema';
import { CurrencyPicker, currencyLabel } from '@/components/currency-picker';
import { FormScroll } from '@/components/keyboard';
import { Button, Chip, Chips, ErrorText, Field, colors, radius } from '@/components/ui';
import { listAccountTypes } from '@/lib/account-types';
import { createAccount, FOREIGN_CAPABLE_TYPES } from '@/lib/accounts';
import { useHomeCurrency } from '@/lib/home-currency';
import { syncNow } from '@/lib/sync';
import { useLedger } from '@/lib/use-ledger';

/** A built-in type, or one of the user's own (ACC-6). */
type Choice = { type: AccountType; custom: LocalAccountType | null };

export default function AddAccount() {
  const { data: customTypes } = useLedger(listAccountTypes, [] as LocalAccountType[]);
  const [choice, setChoice] = useState<Choice>({ type: 'bank', custom: null });
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [last4, setLast4] = useState('');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const home = useHomeCurrency();
  const [chosenCurrency, setChosenCurrency] = useState<CurrencyCode | null>(null);
  const [pickingCurrency, setPickingCurrency] = useState(false);

  const liability = choice.custom ? choice.custom.class === 'liability' : LIABILITY_TYPES.has(choice.type);
  // An FD or RD's balance comes from its terms (NW-2), asked for next; so do a savings scheme's (NW-6).
  const scheme = !choice.custom && choice.type === 'savings_scheme';
  const deposit = !choice.custom && (choice.type === 'fd' || choice.type === 'rd' || scheme);
  // ACC-12: banks, cards, cash and the user's own types can be in any currency; Indian products stay in rupees.
  const canPickCurrency = FOREIGN_CAPABLE_TYPES.has(choice.type);
  const currency = canPickCurrency ? (chosenCurrency ?? home) : 'INR';
  const symbol = currencyInfo(currency).symbol.trim();

  async function save() {
    const parsed = parseMoney(balance.trim() === '' ? '0' : balance, currency);
    if (parsed === null) return setError('Enter the balance as a number, for example 12,500.50');
    const amount = paise(parsed);
    if (last4 !== '' && !/^\d{4}$/.test(last4)) return setError('Last 4 digits must be exactly 4 numbers');

    setSaving(true);
    const id = await createAccount({
      type: choice.type,
      accountTypeId: choice.custom?.id ?? null,
      name: name.trim(),
      institution: institution.trim() || null,
      last4: last4 || null,
      // Balances are signed: money owed on a card, loan or liability type is stored as negative.
      openingBalance: deposit && !scheme ? paise(0) : liability ? paise(-Math.abs(amount)) : amount,
      currency,
    });
    // Saved locally; sync in the background and go back right away.
    syncNow().catch(() => {});
    if (deposit) router.replace(`/deposit?account=${id}`);
    else router.back();
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.label}>Type</Text>
      <Chips>
        {USER_ACCOUNT_TYPES.map((option) => (
          <Chip
            key={option}
            label={ACCOUNT_TYPE_LABELS[option]}
            selected={!choice.custom && option === choice.type}
            onPress={() => setChoice({ type: option, custom: null })}
          />
        ))}
        {customTypes.map((custom) => (
          <Chip
            key={custom.id}
            label={custom.name}
            selected={choice.custom?.id === custom.id}
            onPress={() => setChoice({ type: 'custom', custom })}
          />
        ))}
        <Chip label="+ New type" selected={false} onPress={() => router.push('/account-types')} />
      </Chips>

      {canPickCurrency && (
        <>
          <Text style={styles.fieldLabel}>Currency</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Currency: ${currencyLabel(currency)}`}
            onPress={() => setPickingCurrency(true)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rowText}>{currencyLabel(currency)}</Text>
            <Feather name="chevron-down" size={18} color={colors.muted} />
          </Pressable>
        </>
      )}
      <Field label="Name" value={name} onChangeText={setName} placeholder="HDFC savings" maxLength={80} />
      <Field label="Bank or provider (optional)" value={institution} onChangeText={setInstitution} placeholder="HDFC Bank" />
      <Field
        label="Last 4 digits (optional)"
        value={last4}
        onChangeText={setLast4}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="1234"
      />
      {scheme ? (
        <>
          <Field label={`Balance today (${symbol})`} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0" />
          <Text style={styles.hint}>
            For PPF, EPF or Sukanya Samriddhi, the balance in your passbook. Leave it at 0 for NSC or KVP. Next, pick the scheme and its rate.
          </Text>
        </>
      ) : deposit ? (
        <Text style={styles.hint}>Next, add the amount, rate and dates. The balance and interest are worked out from them.</Text>
      ) : (
        <Field
          label={liability ? `Amount you owe now (${symbol})` : `Current balance (${symbol})`}
          value={balance}
          onChangeText={setBalance}
          keyboardType="decimal-pad"
          placeholder="0"
        />
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <CurrencyPicker
        visible={pickingCurrency}
        title="Account currency"
        selected={currency}
        onClose={() => setPickingCurrency(false)}
        onPick={(code) => {
          setChosenCurrency(code);
          setPickingCurrency(false);
        }}
      />
      <View style={styles.actions}>
        <Button title={deposit ? 'Next' : 'Save'} onPress={save} loading={saving} disabled={name.trim() === ''} />
      </View>
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6 },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 16 },
  actions: { marginTop: 24 },
  fieldLabel: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, fontSize: 15, color: colors.text },
  pressed: { backgroundColor: colors.pressed },
});
