import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatRupees, paise, parseRupees } from '@money-plant/core';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { editEntry } from '@/lib/entries';
import { getTransaction, listAccountBalances, type AccountBalance, type TransactionRow } from '@/lib/ledger';

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-10-21 14:32" in the phone's time zone. */
function toLocalText(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalText(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 ? null : date.toISOString();
}

/** LED-8: edit every field of an entry. Changed fields are kept from then on. */
export default function EditEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [row, setRow] = useState<TransactionRow | null>(null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState('');
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
      setWhen(toLocalText(loaded.tx.occurredAt));
      setNote(loaded.tx.note ?? '');
    });
  }, [id]);

  if (!row) return null;
  const twoLegs = row.tx.postings.length === 2;

  async function save() {
    const parsedAmount = parseRupees(amount);
    if (twoLegs && (parsedAmount === null || parsedAmount <= 0)) return setError('Enter the amount as a number above zero');
    const occurredAt = fromLocalText(when);
    if (!occurredAt) return setError('Enter the date as YYYY-MM-DD HH:MM, for example 2026-10-21 14:30');
    setSaving(true);
    try {
      const { tx } = row!;
      // Only fields that actually changed become user-set.
      await editEntry(id, {
        counterparty: payee.trim() === (tx.counterparty ?? '') ? undefined : payee,
        note: note.trim() === (tx.note ?? '') ? undefined : note,
        occurredAt: toLocalText(tx.occurredAt) === when.trim() ? undefined : occurredAt,
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
      <Field label="Date and time" value={when} onChangeText={setWhen} placeholder="2026-10-21 14:30" autoCapitalize="none" />
      {twoLegs && (
        <>
          <Text style={styles.label}>{row.tx.kind === 'transfer' ? 'From account' : 'Account'}</Text>
          <Chips>
            {accounts.map((a) => (
              <Chip key={a.account.id} label={a.account.name} selected={a.account.id === accountId} onPress={() => setAccountId(a.account.id)} />
            ))}
          </Chips>
        </>
      )}
      <Field label="Note" value={note} onChangeText={setNote} multiline maxLength={500} />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  body: { fontSize: 14, color: colors.muted },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6, marginTop: 16 },
  actions: { marginTop: 24 },
});
