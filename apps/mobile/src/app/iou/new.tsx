import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { dateOf, formatRupees, isDateKey, paise, parseRupees, type Paise } from '@money-plant/core';
import type { IouDirection, LedgerTransaction } from '@money-plant/matcher';
import { formatDate } from '@/components/format';
import { PersonPicker } from '@/components/person-picker';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { createIou, loanCandidates, type EntryLink } from '@/lib/ious';
import { getTransaction, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { listPeople, personForPayee, type Person } from '@/lib/people';
import { today } from '@/lib/recurring';

const linkKey = (link: EntryLink | null) => (link === null ? '' : 'existingId' in link ? `tx:${link.existingId}` : `acc:${link.accountId}`);

/**
 * IOU-1: money lent or borrowed. `?from=<entry id>` starts from a bank entry
 * (Review's "Lent" action), `?person=<id>` from a person.
 */
export default function NewIou() {
  const params = useLocalSearchParams<{ from?: string; person?: string }>();
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [personId, setPersonId] = useState<string | null>(params.person ?? null);
  const [direction, setDirection] = useState<IouDirection>('lent');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [fromTx, setFromTx] = useState<LedgerTransaction | null>(null);
  const [candidates, setCandidates] = useState<LedgerTransaction[]>([]);
  const [link, setLink] = useState<EntryLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);

  useEffect(() => {
    (async () => {
      setAccounts(await listAccountBalances());
      await reloadPeople();
      if (!params.from) return;
      const row = await getTransaction(params.from);
      const own = row?.legs[0];
      if (!row || !own) return;
      setFromTx(row.tx);
      setLink({ existingId: row.tx.id });
      setDirection(own.amount < 0 ? 'lent' : 'borrowed');
      setAmount(formatRupees(paise(Math.abs(own.amount)), { symbol: false }).replace(/,/g, ''));
      setOccurredOn(dateOf(row.tx.occurredAt));
      if (!params.person && row.tx.counterparty) {
        const vpa = row.tx.sources.find((s) => s.kind === 'sms')?.parsedFields.vpa;
        setPersonId(await personForPayee({ name: row.tx.counterparty, vpa: typeof vpa === 'string' ? vpa : null }));
        await reloadPeople();
      }
    })();
  }, [params.from, params.person, reloadPeople]);

  // Offer the bank entry that is probably this loan.
  const parsed = parseRupees(amount);
  useEffect(() => {
    if (fromTx || parsed === null || parsed <= 0 || !isDateKey(occurredOn)) return setCandidates([]);
    loanCandidates(direction, parsed as Paise, occurredOn).then(setCandidates);
  }, [fromTx, parsed, direction, occurredOn]);

  async function save() {
    if (!personId) return setError('Pick who it is with');
    if (parsed === null || parsed <= 0) return setError('Enter the amount as a number above zero');
    if (!isDateKey(occurredOn.trim())) return setError('Enter the date as YYYY-MM-DD');
    if (dueDate.trim() && !isDateKey(dueDate.trim())) return setError('Enter the due date as YYYY-MM-DD, or leave it empty');
    if (!link) return setError(direction === 'lent' ? 'Pick where the money went out from' : 'Pick where the money came in');
    setSaving(true);
    try {
      const id = await createIou(
        { personId, direction, amount: parsed, reason: reason.trim() || null, occurredOn: occurredOn.trim(), dueDate: dueDate.trim() || null },
        link,
      );
      router.replace(`/iou/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>With</Text>
      <PersonPicker
        people={people}
        selected={personId ? [personId] : []}
        onToggle={(id) => setPersonId(id === personId ? null : id)}
        onCreated={(id) => reloadPeople().then(() => setPersonId(id))}
      />

      <Text style={styles.label}>What happened</Text>
      <Chips>
        <Chip label="I lent money" selected={direction === 'lent'} onPress={() => !fromTx && setDirection('lent')} />
        <Chip label="I borrowed money" selected={direction === 'borrowed'} onPress={() => !fromTx && setDirection('borrowed')} />
      </Chips>
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!fromTx} />
      <Field label="What for" value={reason} onChangeText={setReason} placeholder="Concert tickets" maxLength={200} />
      <Field label="Date" value={occurredOn} onChangeText={setOccurredOn} autoCapitalize="none" editable={!fromTx} />
      <Field label="Due date (optional)" value={dueDate} onChangeText={setDueDate} placeholder="2026-11-30" autoCapitalize="none" />
      <Text style={styles.hint}>You get a reminder the day before and on the day.</Text>

      <Text style={styles.label}>{direction === 'lent' ? 'The money went out from' : 'The money came into'}</Text>
      {fromTx ? (
        <Text style={styles.value}>
          The bank entry for {fromTx.counterparty ?? 'this payment'} on {formatDate(fromTx.occurredAt)}
        </Text>
      ) : (
        <>
          <Chips>
            {candidates.map((tx) => (
              <Chip
                key={tx.id}
                label={`Entry: ${tx.counterparty ?? 'payment'}, ${formatDate(tx.occurredAt)}`}
                selected={linkKey(link) === `tx:${tx.id}`}
                onPress={() => setLink({ existingId: tx.id })}
              />
            ))}
            {accounts.map((b) => (
              <Chip
                key={b.account.id}
                label={b.account.name}
                selected={linkKey(link) === `acc:${b.account.id}`}
                onPress={() => setLink({ accountId: b.account.id })}
              />
            ))}
          </Chips>
          <Text style={styles.hint}>
            {candidates.length > 0
              ? 'Pick the bank entry if this loan is already in your ledger, so it is not counted twice.'
              : 'Picking an account adds the entry to your ledger. Already in your SMS? Use Lent on that entry in Review instead.'}
          </Text>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  value: { fontSize: 15, color: colors.text },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
});
