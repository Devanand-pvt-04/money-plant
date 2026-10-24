import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { formatRupees, paise, parseRupees } from '@money-plant/core';
import { AccountPicker, accountIcon, accountLabel } from '@/components/account-picker';
import { DateTimeField } from '@/components/date-fields';
import { Button, ErrorText, Field, colors, radius } from '@/components/ui';
import { editEntry } from '@/lib/entries';
import { getTransaction, listAccountBalances, type AccountBalance, type TransactionRow } from '@/lib/ledger';

/** LED-8: edit every field of an entry. Changed fields are kept from then on. */
export default function EditEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [row, setRow] = useState<TransactionRow | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState('');
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getTransaction(id), listAccountBalances()]).then(([loaded, balances]) => {
      if (!loaded) return;
      setRow(loaded);
      setAccounts(balances);
      setPayee(loaded.tx.counterparty ?? '');
      const own = loaded.legs.find((leg) => loaded.tx.kind !== 'transfer' || leg.amount < 0) ?? loaded.legs[0];
      setAmount(own ? formatRupees(paise(Math.abs(own.amount)), { symbol: false }) : '');
      setAccountId(own?.accountId ?? null);
      setWhen(loaded.tx.occurredAt);
      setNote(loaded.tx.note ?? '');
    });
  }, [id]);

  if (!row) return null;
  const account = accounts.find((a) => a.account.id === accountId);
  const twoLegs = row.tx.postings.length === 2;

  async function save() {
    const parsedAmount = parseRupees(amount);
    if (twoLegs && (parsedAmount === null || parsedAmount <= 0)) return setError('Enter the amount as a number above zero');
    setSaving(true);
    try {
      const { tx } = row!;
      // Only fields that actually changed become user-set.
      await editEntry(id, {
        counterparty: payee.trim() === (tx.counterparty ?? '') ? undefined : payee,
        note: note.trim() === (tx.note ?? '') ? undefined : note,
        occurredAt: when === tx.occurredAt ? undefined : when,
        ...(twoLegs ? { amount: parsedAmount!, accountId: accountId ?? undefined } : {}),
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.body}>Fields you change here stay as you set them. The original message stays visible under Sources.</Text>
      {row.tx.kind !== 'transfer' && <Field label="Payee" value={payee} onChangeText={setPayee} maxLength={120} />}
      {twoLegs && <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />}
      <Text style={styles.label}>Date and time</Text>
      <DateTimeField value={when} onChange={setWhen} />
      {twoLegs && (
        <>
          <Text style={styles.label}>{row.tx.kind === 'transfer' ? 'From account' : 'Account'}</Text>
          <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [styles.account, pressed && styles.pressed]}>
            <Feather name={account ? accountIcon(account.account.type) : 'plus'} size={18} color={colors.muted} />
            <Text style={styles.accountText}>{account ? accountLabel(account.account) : 'Pick an account'}</Text>
            <Feather name="chevron-down" size={18} color={colors.muted} />
          </Pressable>
        </>
      )}
      <Field label="Note" value={note} onChangeText={setNote} multiline maxLength={500} />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
      <AccountPicker
        visible={picking}
        onPick={(picked) => {
          setAccounts((all) => (all.some((a) => a.account.id === picked.account.id) ? all : [...all, picked]));
          setAccountId(picked.account.id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  body: { fontSize: 14, color: colors.muted },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6, marginTop: 16 },
  actions: { marginTop: 24 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  accountText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  pressed: { backgroundColor: colors.pressed },
});
