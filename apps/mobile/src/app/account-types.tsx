import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { AccountClass } from '@money-plant/core';
import type { LocalAccountType } from '@money-plant/db-schema';
import { Button, Chip, Chips, ErrorText, Field, SectionTitle, colors } from '@/components/ui';
import { createAccountType, deleteAccountType, listAccountTypes, updateAccountType } from '@/lib/account-types';
import { useLedger } from '@/lib/use-ledger';

/** ACC-6: account types the user names, on a fixed asset or liability class. */
export default function AccountTypes() {
  const { data: types } = useLedger(listAccountTypes, [] as LocalAccountType[]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountClass>('asset');
  const [inNetWorth, setInNetWorth] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (types.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) return setError('You already have a type with that name');
    await createAccountType({ name, class: kind, inNetWorth });
    setName('');
    setError(null);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.body}>
        Add types the app doesn't have, like Chit fund, PF or Gold. They work as manual accounts: you set the balance and add entries by hand.
      </Text>
      <Field label="Type name" value={name} onChangeText={setName} placeholder="Chit fund" maxLength={40} />
      <Text style={styles.label}>It is</Text>
      <Chips>
        <Chip label="Something I own (asset)" selected={kind === 'asset'} onPress={() => setKind('asset')} />
        <Chip label="Something I owe (liability)" selected={kind === 'liability'} onPress={() => setKind('liability')} />
      </Chips>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Count toward net worth</Text>
        <Switch value={inNetWorth} onValueChange={setInNetWorth} />
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Button title="Add type" onPress={add} disabled={name.trim() === ''} />

      {types.length > 0 && <SectionTitle>Your types</SectionTitle>}
      {types.map((t) => (
        <View key={t.id} style={styles.card}>
          <View style={styles.cardText}>
            <Text style={styles.name}>{t.name}</Text>
            <Text style={styles.meta}>{t.class === 'asset' ? 'Asset' : 'Liability'}</Text>
          </View>
          <Switch value={t.inNetWorth === 1} onValueChange={(value) => updateAccountType(t.id, { inNetWorth: value })} />
          <Button
            title="Delete"
            variant="secondary"
            onPress={() =>
              deleteAccountType(t.id).catch((e) => Alert.alert("Couldn't delete", e instanceof Error ? e.message : String(e)))
            }
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 8 },
  body: { fontSize: 14, color: colors.muted },
  label: { fontSize: 14, color: colors.muted, marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  switchLabel: { fontSize: 15, color: colors.text, flex: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
});
