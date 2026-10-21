import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ACCOUNT_TYPE_LABELS, USER_ACCOUNT_TYPES, parseRupees, type AccountType } from '@money-plant/core';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { createAccount } from '@/lib/accounts';
import { syncNow } from '@/lib/sync';

export default function AddAccount() {
  const [type, setType] = useState<AccountType>('bank');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [last4, setLast4] = useState('');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const openingBalance = parseRupees(balance.trim() === '' ? '0' : balance);
    if (openingBalance === null) return setError('Enter the balance as a number, for example 12,500.50');
    if (last4 !== '' && !/^\d{4}$/.test(last4)) return setError('Last 4 digits must be exactly 4 numbers');

    setSaving(true);
    await createAccount({
      type,
      name: name.trim(),
      institution: institution.trim() || null,
      last4: last4 || null,
      openingBalance,
    });
    // Saved locally; sync in the background and go back right away.
    syncNow().catch(() => {});
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Type</Text>
      <View style={styles.chips}>
        {USER_ACCOUNT_TYPES.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: option === type }}
            onPress={() => setType(option)}
            style={[styles.chip, option === type && styles.chipSelected]}
          >
            <Text style={[styles.chipText, option === type && styles.chipTextSelected]}>
              {ACCOUNT_TYPE_LABELS[option]}
            </Text>
          </Pressable>
        ))}
      </View>

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
      <Field
        label="Current balance (₹)"
        value={balance}
        onChangeText={setBalance}
        keyboardType="decimal-pad"
        placeholder="0"
      />

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} disabled={name.trim() === ''} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: '#E3F1E8' },
  chipText: { color: colors.text },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
  actions: { marginTop: 24 },
});
