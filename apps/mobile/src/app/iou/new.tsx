import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { currencyInfo, dateOf, formatMoney, isDateKey, paise, parseMoney, type Paise } from '@money-plant/core';
import type { IouDirection, LedgerTransaction } from '@money-plant/matcher';
import { FormScroll } from '@/components/keyboard';
import { DateField, DateTimeField, formatWhen } from '@/components/date-fields';
import { formatDate } from '@/components/format';
import { PersonPicker } from '@/components/person-picker';
import { Button, Chip, Chips, ErrorText, Field, makeStyles } from '@/components/ui';
import { createIou, loanCandidates, type EntryLink } from '@/lib/ious';
import { getTransaction, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { createPerson, findPersonForPayee, listPeople, type Person } from '@/lib/people';
import { homeCurrency } from '@/lib/home-currency';
import { isVpa } from '@/lib/me';

const linkKey = (link: EntryLink | null) => (link === null ? '' : 'existingId' in link ? `tx:${link.existingId}` : `acc:${link.accountId}`);

/**
 * IOU-1: money lent or borrowed. `?from=<entry id>` starts from a bank entry
 * (Review's "Lent" action), `?person=<id>` from a person.
 */
export default function NewIou() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ from?: string; person?: string }>();
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [personId, setPersonIdState] = useState<string | null>(params.person ?? null);
  // The entry's payee when they aren't one of the user's people yet: created only on save.
  const [draft, setDraft] = useState<{ name: string; vpa: string | null } | null>(null);
  const [draftSelected, setDraftSelected] = useState(false);
  const setPersonId = (id: string | null) => {
    setPersonIdState(id);
    if (id) setDraftSelected(false);
  };
  const [direction, setDirection] = useState<IouDirection>('lent');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString());
  const occurredOn = dateOf(occurredAt);
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
      setAmount(formatMoney(paise(Math.abs(own.amount)), own.currency, { symbol: false }).replace(/,/g, ''));
      setOccurredAt(row.tx.occurredAt);
      if (!params.person && row.tx.counterparty) {
        const smsVpa = row.tx.sources.find((s) => s.kind === 'sms')?.parsedFields.vpa;
        const payee = { name: row.tx.counterparty, vpa: typeof smsVpa === 'string' && isVpa(smsVpa) ? smsVpa : null };
        const found = await findPersonForPayee(payee);
        if (found) setPersonId(found);
        else {
          setDraft(payee);
          setDraftSelected(true);
        }
      }
    })();
  }, [params.from, params.person, reloadPeople]);

  // Offer the bank entry that is probably this loan.
  // The loan is in its entry's currency, or the account's, else the home currency (decision 0017).
  const linkedTx = link && 'existingId' in link ? [fromTx, ...candidates].find((tx) => tx?.id === link.existingId) : undefined;
  const currency =
    linkedTx?.postings.find((p) => p.currency)?.currency ??
    (link && 'accountId' in link ? accounts.find((b) => b.account.id === link.accountId)?.currency : undefined) ??
    homeCurrency();
  const typed = parseMoney(amount, currency);
  const parsed = typed === null ? null : paise(typed);
  useEffect(() => {
    if (fromTx || parsed === null || parsed <= 0 || !isDateKey(occurredOn)) return setCandidates([]);
    loanCandidates(direction, parsed as Paise, occurredOn).then(setCandidates);
  }, [fromTx, parsed, direction, occurredOn]);

  async function save() {
    if (!personId && !(draft && draftSelected)) return setError('Pick who it is with');
    if (parsed === null || parsed <= 0) return setError('Enter the amount as a number above zero');
    if (dueDate.trim() && !isDateKey(dueDate.trim())) return setError('Enter the due date as YYYY-MM-DD, or leave it empty');
    if (!link) return setError(direction === 'lent' ? 'Pick where the money went out from' : 'Pick where the money came in');
    setSaving(true);
    try {
      let who = personId;
      if (!who) {
        who = await createPerson({ name: draft!.name, vpa: draft!.vpa });
        // Kept, so trying again after an error doesn't add them twice.
        setDraft(null);
        setPersonId(who);
        await reloadPeople();
      }
      const id = await createIou(
        { personId: who, direction, amount: parsed, reason: reason.trim() || null, occurredOn, occurredAt, dueDate: dueDate.trim() || null },
        link,
      );
      router.replace(`/iou/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.label}>With</Text>
      <PersonPicker
        people={people}
        selected={personId ? [personId] : []}
        onToggle={(id) => setPersonId(id === personId ? null : id)}
        onCreated={(id) => reloadPeople().then(() => setPersonId(id))}
        draft={
          draft
            ? {
                name: draft.name,
                selected: draftSelected && !personId,
                onToggle: () => {
                  setDraftSelected(!(draftSelected && !personId));
                  setPersonIdState(null);
                },
              }
            : null
        }
      />

      <Text style={styles.label}>What happened</Text>
      <Chips>
        <Chip label="I lent money" selected={direction === 'lent'} onPress={() => !fromTx && setDirection('lent')} />
        <Chip label="I borrowed money" selected={direction === 'borrowed'} onPress={() => !fromTx && setDirection('borrowed')} />
      </Chips>
      <Field label={`Amount (${currencyInfo(currency).symbol.trim()})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!fromTx} />
      <Field label="What for" value={reason} onChangeText={setReason} placeholder="Concert tickets" maxLength={200} />
      {fromTx ? (
        <Field label="When" value={formatWhen(fromTx.occurredAt)} editable={false} />
      ) : (
        <DateTimeField label="When" value={occurredAt} onChange={setOccurredAt} style={styles.date} />
      )}
      <DateField label="Due date" value={dueDate || null} onChange={(key) => setDueDate(key ?? '')} optional placeholder="None" min={occurredOn} style={styles.date} />
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
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  value: { fontSize: 15, color: colors.text },
  date: { marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10 },
}));
