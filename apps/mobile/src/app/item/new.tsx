import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { dateKey, dateOf, paise, type CurrencyCode, type DateKey, type Paise } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { accountLabel } from '@/components/account-picker';
import { CategoryPicker } from '@/components/category-picker';
import { pickDate } from '@/components/date-fields';
import { formatAmount, formatDate, formatDay } from '@/components/format';
import { KeyboardGap, useKeyboard } from '@/components/keyboard';
import { Keypad, fromMinor, keypadDisplay, toMinor } from '@/components/keypad';
import { MoneySideSheet, type MoneySide } from '@/components/money-side-sheet';
import { PeopleSheet } from '@/components/people-sheet';
import { Button, ErrorText, Initial, figures, radius, useColors, makeStyles } from '@/components/ui';
import { homeCurrency } from '@/lib/home-currency';
import { getTransaction } from '@/lib/ledger';
import { isVpa } from '@/lib/me';
import { createPerson, findPersonForPayee, listPeople, SamePersonError, type Person } from '@/lib/people';
import { createItem, entriesFitting, listItems, type EntrySide, type ItemFlow, type ItemKind } from '@/lib/shared';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** The four things that happen with someone, from the user's side (decision 0030). */
type Action = 'lend' | 'borrow' | 'back' | 'paidForMe';

const ACTIONS: Record<Action, { label: string; icon: FeatherName }> = {
  lend: { label: 'I lent', icon: 'arrow-up-right' },
  borrow: { label: 'I borrowed', icon: 'arrow-down-left' },
  back: { label: 'Paid back', icon: 'rotate-ccw' },
  paidForMe: { label: 'Paid for me', icon: 'shopping-bag' },
};

function itemOf(action: Action, backFlow: ItemFlow): { kind: ItemKind; flow: ItemFlow } {
  if (action === 'lend') return { kind: 'loan', flow: 'to_them' };
  if (action === 'borrow') return { kind: 'loan', flow: 'to_me' };
  if (action === 'paidForMe') return { kind: 'share', flow: 'to_me' };
  return { kind: 'repayment', flow: backFlow };
}

/** How the person's balance moves, per unit: above zero means they owe the user more. */
function direction(action: Action, backFlow: ItemFlow): 1 | -1 {
  if (action === 'lend') return 1;
  if (action === 'back') return backFlow === 'to_them' ? 1 : -1;
  return -1;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * A loan, a repayment, or a share someone else paid (decision 0030): pick the
 * person from recent avatars, one of four round actions, type the amount on
 * the keypad. `?from=<entry id>` starts from one of the user's entries (I lent
 * it, Paid me back), `?person=<id>` from a person. A bill the user paid goes
 * to the split screen (decision 0027).
 */
export default function NewItem() {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const typing = useKeyboard().height > 0;
  const params = useLocalSearchParams<{ from?: string; person?: string; kind?: string; flow?: string }>();
  const [people, setPeople] = useState<Person[]>([]);
  const [recent, setRecent] = useState<Map<string, string>>(new Map());
  const [personId, setPersonIdState] = useState<string | null>(params.person ?? null);
  // The entry's payee when they aren't one of the user's people yet: created only on save.
  const [draft, setDraft] = useState<{ name: string; vpa: string | null } | null>(null);
  const [draftSelected, setDraftSelected] = useState(false);
  const setPersonId = (id: string | null) => {
    setPersonIdState(id);
    if (id) setDraftSelected(false);
  };
  const [fromTx, setFromTx] = useState<{ tx: LedgerTransaction; own: Paise; currency: CurrencyCode } | null>(null);
  const [action, setAction] = useState<Action>(() =>
    params.kind === 'repayment' ? 'back' : params.kind === 'share' && params.flow === 'to_me' ? 'paidForMe' : params.flow === 'to_me' ? 'borrow' : 'lend',
  );
  // For a repayment: who paid whom. Left unset until the user or the balance says.
  const [backFlow, setBackFlow] = useState<ItemFlow | null>(params.kind === 'repayment' && (params.flow === 'to_me' || params.flow === 'to_them') ? params.flow : null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState<DateKey>(() => dateKey(new Date()));
  const [category, setCategory] = useState<{ id: string; name: string } | null>(null);
  const [candidates, setCandidates] = useState<LedgerTransaction[]>([]);
  const [side, setSide] = useState<MoneySide>({ type: 'later' });
  const [sideName, setSideName] = useState<string | null>(null);
  const [sideAccountCurrency, setSideAccountCurrency] = useState<CurrencyCode | null>(null);
  const [picking, setPicking] = useState<'people' | 'side' | 'category' | null>(null);
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
      await reloadPeople();
      const latest = new Map<string, string>();
      for (const v of await listItems()) if (v.personId && (latest.get(v.personId) ?? '') < v.occurredOn) latest.set(v.personId, v.occurredOn);
      setRecent(latest);
      if (!params.from) return;
      const row = await getTransaction(params.from);
      const own = row?.legs[0];
      if (!row || !own) return;
      setFromTx({ tx: row.tx, own: own.amount, currency: own.currency });
      setSide({ type: 'entry', id: row.tx.id });
      const out = own.amount < 0;
      // Money out of the user's account: they lent it or paid back. Money in: they borrowed or were paid back.
      setAction(params.kind === 'repayment' ? 'back' : out ? 'lend' : 'borrow');
      setBackFlow(out ? 'to_them' : 'to_me');
      setText(fromMinor(Math.abs(own.amount), own.currency));
      setOccurredOn(dateOf(row.tx.occurredAt));
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
  }, [params.from, params.person, params.kind, reloadPeople]);

  const person = people.find((p) => p.account.id === personId) ?? null;
  const name = person?.account.name ?? (draft && draftSelected ? draft.name : null);
  const currency = fromTx?.currency ?? (side.type === 'account' ? sideAccountCurrency : null) ?? homeCurrency();
  const before = person?.balances.find((b) => b.currency === currency)?.amount ?? 0;
  // Who paid whom, when the user hasn't said: whoever owes is the one paying back.
  const flowBack: ItemFlow = backFlow ?? (before < 0 ? 'to_them' : 'to_me');
  const { kind, flow } = itemOf(action, flowBack);
  const amount = toMinor(text, currency);
  const paidByThem = action === 'paidForMe';
  const outstanding = action === 'back' ? (flowBack === 'to_me' ? before : -before) : 0;

  // From an entry only the actions its direction allows; a bill the user paid opens Split.
  const actions: Action[] = fromTx ? (fromTx.own < 0 ? ['lend', 'back'] : ['borrow', 'back']) : ['lend', 'borrow', 'back', 'paidForMe'];

  // Offer the entries that are probably the user's side of it.
  useEffect(() => {
    if (fromTx || paidByThem || amount <= 0) return setCandidates([]);
    let live = true;
    entriesFitting({ kind, flow, amount: paise(amount), occurredOn, personId }).then((found) => live && setCandidates(found.slice(0, 4)));
    return () => {
      live = false;
    };
  }, [fromTx, paidByThem, amount, kind, flow, occurredOn, personId]);

  // A picked entry stops fitting once the amount, action or date changes.
  useEffect(() => {
    if (!fromTx && side.type === 'entry' && !candidates.some((tx) => tx.id === side.id)) setSide({ type: 'later' });
  }, [fromTx, side, candidates]);

  const strip = useMemo(() => {
    const byRecent = [...people].sort((a, b) => (recent.get(b.account.id) ?? '').localeCompare(recent.get(a.account.id) ?? ''));
    const top = byRecent.slice(0, 8);
    if (person && !top.includes(person)) top.unshift(person);
    return top;
  }, [people, recent, person]);

  const sideFor = (): EntrySide => {
    if (paidByThem) return category ? { categoryId: category.id } : null;
    if (side.type === 'entry') return { transactionId: side.id };
    if (side.type === 'account') return { accountId: side.id, occurredAt: new Date(`${occurredOn}T12:00:00`).toISOString() };
    return null;
  };

  async function save() {
    if (!personId && !(draft && draftSelected)) return setError('Pick who it is with');
    if (amount <= 0) return setError('Type the amount');
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
      const id = await createItem({ personId: who, kind, flow, amount: paise(amount), occurredOn, reason: reason?.trim() || null }, sideFor());
      router.replace(`/item/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  // The Save button says where the two of you will stand (decision 0030).
  const short = name ? firstName(name) : null;
  const after = before + direction(action, flowBack) * amount;
  const saveTitle =
    amount <= 0 || !short
      ? 'Save'
      : after > 0
        ? `Save: ${short} will owe you ${formatAmount(after, currency)}`
        : after < 0
          ? `Save: you'll owe ${short} ${formatAmount(-after, currency)}`
          : "Save: you're all square";
  const beforeText =
    amount > 0 && short && before !== 0
      ? before > 0
        ? `${short} owed you ${formatAmount(before, currency)} before this`
        : `You owed ${short} ${formatAmount(-before, currency)} before this`
      : null;

  const who = short ?? 'They';
  const meaning: Record<Action, string> = {
    lend: `You gave ${short ?? 'them'} money; it comes back to you`,
    borrow: `${who} gave you money; you'll pay it back`,
    back: flowBack === 'to_me' ? `${who} paid you back` : `You paid ${short ?? 'them'} back`,
    paidForMe: `${who} paid; your share counts as your spending`,
  };

  const out = kind === 'share' ? false : flow === 'to_them';
  const sideChip = fromTx
    ? { icon: 'link' as FeatherName, label: `Entry: ${fromTx.tx.counterparty ?? 'payment'}` }
    : side.type === 'later'
      ? { icon: 'message-square' as FeatherName, label: 'Comes by SMS' }
      : side.type === 'entry'
        ? { icon: 'link' as FeatherName, label: `Entry: ${candidates.find((tx) => tx.id === side.id)?.counterparty ?? 'payment'}` }
        : { icon: 'briefcase' as FeatherName, label: `${out ? 'From' : 'Into'} ${sideName ?? 'account'}` };

  const chip = (props: { icon: FeatherName; label: string; onPress?: () => void; muted?: boolean; on?: boolean; a11y?: string }) => (
    <Pressable
      key={props.label}
      accessibilityRole="button"
      accessibilityLabel={props.a11y ?? props.label}
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => [styles.chip, props.on && styles.chipOn, pressed && styles.pressed]}
    >
      <Feather name={props.icon} size={13} color={props.on ? colors.primary : colors.muted} />
      <Text style={[styles.chipText, props.muted && styles.chipMuted, props.on && styles.chipTextOn]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 12 }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="Search people" onPress={() => setPicking('people')} style={styles.face}>
          <View style={styles.search}>
            <Feather name="search" size={19} color={colors.muted} />
          </View>
          <Text style={styles.faceName}>Search</Text>
        </Pressable>
        {draft && (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: draftSelected && !personId }}
            onPress={() => {
              setDraftSelected(!(draftSelected && !personId));
              setPersonIdState(null);
            }}
            style={styles.face}
          >
            <View style={[styles.ring, draftSelected && !personId && styles.ringOn]}>
              <Initial name={draft.name} size={46} />
            </View>
            <Text style={[styles.faceName, draftSelected && !personId && styles.faceNameOn]} numberOfLines={1}>
              {firstName(draft.name)}
            </Text>
            <Text style={styles.faceNew}>New</Text>
          </Pressable>
        )}
        {strip.map((p) => {
          const on = p.account.id === personId;
          return (
            <Pressable key={p.account.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setPersonId(on ? null : p.account.id)} style={styles.face}>
              <View style={[styles.ring, on && styles.ringOn]}>
                <Initial name={p.account.name} size={46} />
              </View>
              <Text style={[styles.faceName, on && styles.faceNameOn]} numberOfLines={1}>
                {firstName(p.account.name)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        {actions.map((a) => {
          const on = a === action;
          return (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setAction(a);
                setError(null);
              }}
              style={styles.action}
            >
              <View style={[styles.actionIcon, on && styles.actionIconOn]}>
                <Feather name={ACTIONS[a].icon} size={20} color={on ? colors.primary : colors.text} />
              </View>
              <Text style={[styles.actionLabel, on && styles.actionLabelOn]} numberOfLines={1}>
                {ACTIONS[a].label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {action === 'back' && !fromTx ? (
        <View style={styles.segment}>
          {(['to_me', 'to_them'] as const).map((f) => (
            <Pressable key={f} accessibilityRole="radio" accessibilityState={{ selected: flowBack === f }} onPress={() => setBackFlow(f)} style={[styles.segmentItem, flowBack === f && styles.segmentOn]}>
              <Text style={[styles.segmentText, flowBack === f && styles.segmentTextOn]}>{f === 'to_me' ? 'They paid me' : 'I paid them'}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.meaning}>{meaning[action]}</Text>
      )}
      {!fromTx && (
        <Pressable accessibilityRole="link" onPress={() => router.replace(splitHref)} hitSlop={6}>
          <Text style={styles.splitLink}>Split a bill you paid</Text>
        </Pressable>
      )}

      <View style={styles.amountBox}>
        <Text accessibilityLiveRegion="polite" style={[styles.amount, amount === 0 && styles.amountEmpty]} numberOfLines={1} adjustsFontSizeToFit>
          {keypadDisplay(text, currency)}
        </Text>
        {fromTx && <Text style={styles.hint}>The whole entry from {formatDate(fromTx.tx.occurredAt)}</Text>}
        {reason !== null && (
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={paidByThem ? 'Dinner at Anna’s' : 'Concert tickets'}
            placeholderTextColor={colors.placeholder}
            style={styles.noteInput}
            maxLength={120}
            autoFocus
            returnKeyType="done"
            onBlur={() => !reason.trim() && setReason(null)}
          />
        )}
      </View>

      <View style={styles.chips}>
        {action === 'back' && outstanding > 0 && amount !== outstanding && !fromTx &&
          chip({ icon: 'check-circle', label: `All of it, ${formatAmount(outstanding, currency)}`, on: true, onPress: () => setText(fromMinor(outstanding, currency)) })}
        {reason === null && chip({ icon: 'align-left', label: 'What for', muted: true, onPress: () => setReason('') })}
        {chip({ icon: 'calendar', label: formatDay(new Date(`${occurredOn}T12:00:00`).toISOString()), a11y: 'When', onPress: fromTx ? undefined : () => pickDate(occurredOn, setOccurredOn) })}
        {paidByThem
          ? chip({ icon: 'tag', label: category ? category.name : 'Your spending on…', muted: !category, onPress: () => setPicking('category') })
          : chip({ ...sideChip, onPress: fromTx ? undefined : () => setPicking('side') })}
      </View>
      {!fromTx && !paidByThem && candidates.length > 0 && side.type === 'later' && (
        <Text style={styles.found}>An entry in your ledger fits. Tap “Comes by SMS” to link it.</Text>
      )}

      {!typing && !fromTx && <Keypad currency={currency} onChange={setText} keyHeight={52} />}

      <View style={styles.save}>
        {error && <ErrorText>{error}</ErrorText>}
        <Button title={saveTitle} onPress={save} loading={saving} />
        {beforeText && <Text style={styles.before}>{beforeText}</Text>}
      </View>
      <KeyboardGap />

      <PeopleSheet
        visible={picking === 'people'}
        onClose={() => setPicking(null)}
        people={people}
        recent={recent}
        selected={personId ? [personId] : []}
        onToggle={(id) => {
          setPersonId(id === personId ? null : id);
          setPicking(null);
        }}
        onCreated={(id) =>
          reloadPeople().then(() => {
            setPersonId(id);
            setPicking(null);
          })
        }
      />
      <MoneySideSheet
        visible={picking === 'side'}
        title={out ? 'Where did the money go out from?' : 'Where did the money come in?'}
        subtitle={out ? 'From one of your accounts' : 'Into one of your accounts'}
        candidates={candidates}
        amountLabel={formatAmount(amount, currency)}
        selected={side}
        onPick={(next, account) => {
          setSide(next);
          setSideName(account ? accountLabel(account.account) : null);
          setSideAccountCurrency(account ? account.account.currency : null);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <CategoryPicker
        visible={picking === 'category'}
        flow="expense"
        onPick={(node) => {
          setCategory({ id: node.id, name: node.name });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  strip: { gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  face: { width: 58, alignItems: 'center', gap: 5 },
  search: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  ring: { padding: 2, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: colors.primary },
  faceName: { fontSize: 12, color: colors.muted, maxWidth: 58 },
  faceNameOn: { color: colors.text, fontWeight: '600' },
  faceNew: { fontSize: 10, color: colors.primary, marginTop: -4 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.divider },
  action: { flex: 1, alignItems: 'center', gap: 6 },
  actionIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconOn: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primarySurface },
  actionLabel: { fontSize: 12, color: colors.muted },
  actionLabelOn: { color: colors.primary, fontWeight: '600' },
  meaning: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingHorizontal: 24, marginTop: 12, minHeight: 38, paddingTop: 8 },
  segment: { alignSelf: 'center', flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.pill, padding: 3, marginTop: 12 },
  segmentItem: { minHeight: 34, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  splitLink: { fontSize: 12, color: colors.primary, textAlign: 'center', marginTop: 4 },
  amountBox: { flex: 1, minHeight: 80, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  amount: { fontSize: 48, fontWeight: '700', letterSpacing: -1.5, color: colors.text, ...figures },
  amountEmpty: { color: colors.placeholder },
  hint: { fontSize: 12, color: colors.muted },
  noteInput: {
    minWidth: 220,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.subtle,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    maxWidth: 220,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  chipText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  chipMuted: { color: colors.muted },
  chipTextOn: { color: colors.primary, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  found: { fontSize: 12, color: colors.primary, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  save: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  before: { fontSize: 12, color: colors.muted, textAlign: 'center' },
}));
