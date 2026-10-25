import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ACCOUNT_TYPE_LABELS, LIABILITY_TYPES, USER_ACCOUNT_TYPES, paise, parseRupees, type AccountType } from '@money-plant/core';
import type { LocalAccountType } from '@money-plant/db-schema';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { listAccountTypes } from '@/lib/account-types';
import { createAccount } from '@/lib/accounts';
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

  const liability = choice.custom ? choice.custom.class === 'liability' : LIABILITY_TYPES.has(choice.type);
  // An FD or RD's balance comes from its terms (NW-2), asked for next.
  const deposit = !choice.custom && (choice.type === 'fd' || choice.type === 'rd');

  async function save() {
    const amount = parseRupees(balance.trim() === '' ? '0' : balance);
    if (amount === null) return setError('Enter the balance as a number, for example 12,500.50');
    if (last4 !== '' && !/^\d{4}$/.test(last4)) return setError('Last 4 digits must be exactly 4 numbers');

    setSaving(true);
    const id = await createAccount({
      type: choice.type,
      accountTypeId: choice.custom?.id ?? null,
      name: name.trim(),
      institution: institution.trim() || null,
      last4: last4 || null,
      // Balances are signed: money owed on a card, loan or liability type is stored as negative.
      openingBalance: deposit ? paise(0) : liability ? paise(-Math.abs(amount)) : amount,
    });
    // Saved locally; sync in the background and go back right away.
    syncNow().catch(() => {});
    if (deposit) router.replace(`/deposit?account=${id}`);
    else router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
      {deposit ? (
        <Text style={styles.hint}>Next, add the amount, rate and dates. The balance and interest are worked out from them.</Text>
      ) : (
        <Field
          label={liability ? 'Amount you owe now (₹)' : 'Current balance (₹)'}
          value={balance}
          onChangeText={setBalance}
          keyboardType="decimal-pad"
          placeholder="0"
        />
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={deposit ? 'Next' : 'Save'} onPress={save} loading={saving} disabled={name.trim() === ''} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6 },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 16 },
  actions: { marginTop: 24 },
});
