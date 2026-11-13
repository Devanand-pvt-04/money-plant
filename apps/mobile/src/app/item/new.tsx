import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { currencyInfo, dateKey, dateOf, formatMoney, paise, parseMoney, type CurrencyCode, type DateKey, type Paise } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { CategoryPicker } from '@/components/category-picker';
import { DateField } from '@/components/date-fields';
import { formatAmount, formatDate } from '@/components/format';
import { FormScroll } from '@/components/keyboard';
import { PersonPicker } from '@/components/person-picker';
import { Button, Chip, Chips, ErrorText, Field, makeStyles } from '@/components/ui';
import { homeCurrency } from '@/lib/home-currency';
import { getTransaction, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { isVpa } from '@/lib/me';
import { createPerson, findPersonForPayee, listPeople, SamePersonError, type Person } from '@/lib/people';
import { createItem, entriesFitting, type EntrySide, type ItemFlow, type ItemKind } from '@/lib/shared';

interface Choice {
  kind: ItemKind;
  flow: ItemFlow;
  label: string;
}

/** From the user's side: what happened between them and the other person (decision 0026). */
const MONEY_OUT: Choice[] = [
  { kind: 'share', flow: 'to_them', label: 'They owe a share' },
  { kind: 'loan', flow: 'to_them', label: 'I lent it' },
  { kind: 'repayment', flow: 'to_them', label: 'I paid them back' },
];
const MONEY_IN: Choice[] = [
  { kind: 'loan', flow: 'to_me', label: 'I borrowed it' },
  { kind: 'repayment', flow: 'to_me', label: 'They paid me back' },
];
const ALL: Choice[] = [
  { kind: 'share', flow: 'to_them', label: 'I paid, they owe a share' },
  { kind: 'share', flow: 'to_me', label: 'They paid, I owe a share' },
  { kind: 'loan', flow: 'to_them', label: 'I lent money' },
  { kind: 'loan', flow: 'to_me', label: 'I borrowed money' },
  { kind: 'repayment', flow: 'to_me', label: 'They paid me back' },
  { kind: 'repayment', flow: 'to_them', label: 'I paid them back' },
];

const sameChoice = (a: Pick<Choice, 'kind' | 'flow'>, b: Pick<Choice, 'kind' | 'flow'>) => a.kind === b.kind && a.flow === b.flow;

type Side = { type: 'entry'; id: string } | { type: 'account'; id: string } | { type: 'later' };

/**
 * A loan, a repayment, or a share someone else paid. `?from=<entry id>` starts
 * from one of the user's entries (I lent it, Paid me back), `?person=<id>`
 * from a person. A bill the user paid goes to the split screen (decision 0027).
 */
export default function NewItem() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ from?: string; person?: string; kind?: string; flow?: string }>();
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  // Several people only for a bill the user paid (step 4); the first is the one for everything else.
  const [personId, setPersonIdState] = useState<string | null>(params.person ?? null);
  // The entry's payee when they aren't one of the user's people yet: created only on save.
  const [draft, setDraft] = useState<{ name: string; vpa: string | null } | null>(null);
  const [draftSelected, setDraftSelected] = useState(false);
  const setPersonId = (id: string | null) => {
    setPersonIdState(id);
    if (id) setDraftSelected(false);
  };
  const [fromTx, setFromTx] = useState<{ tx: LedgerTransaction; own: Paise; currency: CurrencyCode } | null>(null);
  const [choice, setChoice] = useState<Pick<Choice, 'kind' | 'flow'>>({
    kind: params.kind === 'repayment' || (params.kind === 'share' && params.flow === 'to_me') ? params.kind : 'loan',
    flow: params.flow === 'to_me' ? 'to_me' : 'to_them',
  });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState<DateKey>(() => dateKey(new Date()));
  const [category, setCategory] = useState<{ id: string; name: string } | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [candidates, setCandidates] = useState<LedgerTransaction[]>([]);
  const [side, setSide] = useState<Side>({ type: 'later' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);

  // A bill the user paid is split on its own screen (decision 0027).
  const splitHref = `/split?${new URLSearchParams({ ...(params.from ? { from: params.from } : {}), ...(params.person ? { person: params.person } : {}) }).toString()}` as const;
  useEffect(() => {
    if (params.kind === 'share' && params.flow !== 'to_me') router.replace(splitHref);
  }, [params.kind, params.flow, splitHref]);

  useEffect(() => {
    (async () => {
      setAccounts((await listAccountBalances()).filter((b) => b.account.type !== 'loan'));
      await reloadPeople();
      if (!params.from) return;
      const row = await getTransaction(params.from);
      const own = row?.legs[0];
      if (!row || !own) return;
      setFromTx({ tx: row.tx, own: own.amount, currency: own.currency });
      setSide({ type: 'entry', id: row.tx.id });
      const out = own.amount < 0;
      const wanted = params.kind === 'loan' || params.kind === 'repayment' || params.kind === 'share' ? params.kind : out ? 'loan' : 'repayment';
      const next = { kind: !out && wanted === 'share' ? 'repayment' : wanted, flow: out ? 'to_them' : 'to_me' } as const;
      setChoice(next);
      // A share is usually half; a loan or repayment is the whole payment.
      const start = next.kind === 'share' ? Math.round(Math.abs(own.amount) / 2) : Math.abs(own.amount);
      setAmount(formatMoney(paise(start), own.currency, { symbol: false }).replace(/,/g, ''));
      setOccurredOn(dateOf(row.tx.occurredAt));
      if (!params.person && row.tx.counterparty) {
        const smsVpa = row.tx.sources.find((s) => s.kind === 'sms')?.parsedFields.vpa;
        const payee = { name: row.tx.counterparty, vpa: typeof smsVpa === 'string' && isVpa(smsVpa) ? smsVpa : null };
        const found = await findPersonForPayee(payee);
        if (found) setPersonId(found);
        // The payee of a shared bill is the shop, not the person.
        else if (next.kind !== 'share') {
          setDraft(payee);
          setDraftSelected(true);
        }
      }
    })();
  }, [params.from, params.person, params.kind, reloadPeople]);

  const currency = fromTx?.currency ?? (side.type === 'account' ? accounts.find((b) => b.account.id === side.id)?.currency : undefined) ?? homeCurrency();
  const typed = parseMoney(amount, currency);
  const parsed = typed === null ? null : paise(typed);
  const choices = fromTx ? (fromTx.own < 0 ? MONEY_OUT : MONEY_IN) : ALL;
  const paidByThem = choice.kind === 'share' && choice.flow === 'to_me';
  const wholeEntry = fromTx !== null && choice.kind !== 'share';

  function pick(next: Choice) {
    if (next.kind === 'share' && next.flow === 'to_them') return router.replace(splitHref);
    setChoice(next);
    if (fromTx) {
      const whole = Math.abs(fromTx.own);
      const start = next.kind === 'share' ? Math.round(whole / 2) : whole;
      setAmount(formatMoney(paise(start), fromTx.currency, { symbol: false }).replace(/,/g, ''));
    } else if (side.type === 'entry') setSide({ type: 'later' });
  }

  // Offer the entries that are probably the user's side of it.
  useEffect(() => {
    if (fromTx || paidByThem || parsed === null || parsed <= 0) return setCandidates([]);
    let live = true;
    entriesFitting({ kind: choice.kind, flow: choice.flow, amount: parsed, occurredOn, personId }).then((found) => live && setCandidates(found.slice(0, 4)));
    return () => {
      live = false;
    };
  }, [fromTx, paidByThem, parsed, choice.kind, choice.flow, occurredOn, personId]);

  const sideFor = useMemo((): EntrySide => {
    if (paidByThem) return category ? { categoryId: category.id } : null;
    if (side.type === 'entry') return { transactionId: side.id };
    if (side.type === 'account') return { accountId: side.id, occurredAt: new Date(`${occurredOn}T12:00:00`).toISOString() };
    return null;
  }, [paidByThem, category, side, occurredOn]);

  async function save() {
    if (!personId && !(draft && draftSelected)) return setError('Pick who it is with');
    if (parsed === null || parsed <= 0) return setError('Enter the amount as a number above zero');
    if (fromTx && parsed > Math.abs(fromTx.own)) return setError(`This entry is ${formatAmount(Math.abs(fromTx.own), fromTx.currency)}; a share can't be more`);
    if (paidByThem && !category) return setError('Pick what it was for, so it counts in your spending');
    setSaving(true);
    try {
      let who = personId;
      if (!who) {
        try {
          who = await createPerson({ name: draft!.name, vpa: draft!.vpa });
        } catch (e) {
          // That UPI ID is already someone's: it's them, not a new person (decision 0020).
          if (!(e instanceof SamePersonError)) throw e;
          who = e.other.id;
        }
        // Kept, so trying again after an error doesn't add them twice.
        setDraft(null);
        setPersonId(who);
        await reloadPeople();
      }
      const id = await createItem({ personId: who, kind: choice.kind, flow: choice.flow, amount: parsed, occurredOn, reason: reason.trim() || null }, sideFor);
      router.replace(`/item/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const sideLabel =
    choice.kind === 'share'
      ? 'You paid with'
      : choice.flow === 'to_them'
        ? 'The money went out from'
        : 'The money came into';

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
        {choices.map((c) => (
          <Chip key={`${c.kind}:${c.flow}`} label={c.label} selected={sameChoice(c, choice)} onPress={() => pick(c)} />
        ))}
      </Chips>
      <Text style={styles.hint}>
        {choice.kind === 'share'
          ? choice.flow === 'to_them'
            ? 'Their share comes off your spending and shows as owed to you. Your bank balance stays what the bank says.'
            : 'Your share counts as your spending and shows as what you owe. No money moves in your accounts until you pay them back.'
          : 'Money moved between you, so it is linked to the payment in your account.'}
      </Text>

      <Field
        label={`${choice.kind === 'share' ? (choice.flow === 'to_them' ? 'Their share' : 'Your share') : 'Amount'} (${currencyInfo(currency).symbol.trim()})`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        editable={!wholeEntry}
      />
      {fromTx && choice.kind === 'share' && <Text style={styles.hint}>Of {formatAmount(Math.abs(fromTx.own), fromTx.currency)} you paid.</Text>}
      <Field label="What for" value={reason} onChangeText={setReason} placeholder={choice.kind === 'share' ? 'Dinner at Anna’s' : 'Concert tickets'} maxLength={120} />
      {fromTx ? (
        <Field label="When" value={formatDate(fromTx.tx.occurredAt)} editable={false} />
      ) : (
        <DateField label="When" value={occurredOn} onChange={(key) => key && setOccurredOn(key)} style={styles.date} />
      )}

      {paidByThem ? (
        <>
          <Text style={styles.label}>Your spending on</Text>
          <Chips>
            <Chip label={category ? category.name : 'Pick a category'} selected={category !== null} onPress={() => setPickingCategory(true)} />
          </Chips>
        </>
      ) : fromTx ? (
        <>
          <Text style={styles.label}>{sideLabel}</Text>
          <Text style={styles.value}>
            The entry for {fromTx.tx.counterparty ?? 'this payment'} on {formatDate(fromTx.tx.occurredAt)}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>{sideLabel}</Text>
          <Chips>
            {candidates.map((tx) => (
              <Chip
                key={tx.id}
                label={`Entry: ${tx.counterparty ?? 'payment'}, ${formatDate(tx.occurredAt)}`}
                selected={side.type === 'entry' && side.id === tx.id}
                onPress={() => setSide({ type: 'entry', id: tx.id })}
              />
            ))}
            {choice.kind !== 'share' &&
              accounts.map((b) => (
                <Chip
                  key={b.account.id}
                  label={b.account.name}
                  selected={side.type === 'account' && side.id === b.account.id}
                  onPress={() => setSide({ type: 'account', id: b.account.id })}
                />
              ))}
            <Chip label="Link later" selected={side.type === 'later'} onPress={() => setSide({ type: 'later' })} />
          </Chips>
          <Text style={styles.hint}>
            {candidates.length > 0
              ? 'Pick the entry if it is already in your ledger, so it is not counted twice.'
              : choice.kind === 'share'
                ? 'When the payment shows up from your bank, link it from here or from the entry.'
                : 'Picking an account adds the payment to your ledger. If it will come in by SMS, link it later instead.'}
          </Text>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>

      <CategoryPicker
        visible={pickingCategory}
        flow="expense"
        onPick={(node) => {
          setCategory({ id: node.id, name: node.name });
          setPickingCategory(false);
        }}
        onClose={() => setPickingCategory(false)}
      />
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
