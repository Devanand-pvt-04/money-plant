import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { currencyInfo, formatMoney, paise, parseMoney } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { CategoryPicker } from '@/components/category-picker';
import { formatAmount, formatDate } from '@/components/format';
import { FormScroll } from '@/components/keyboard';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, MoneyCard, SectionTitle, makeStyles, useColors } from '@/components/ui';
import { LinkRow } from '@/components/option-row';
import { Sheet } from '@/components/sheet';
import { ItemRow } from '@/components/people-rows';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';
import {
  answerItem,
  candidatesFor,
  deleteItem,
  getItem,
  itemTitle,
  linkEntry,
  sameBill,
  recordEntry,
  statusText,
  unlinkEntry,
  updateItem,
  type ItemView,
} from '@/lib/shared';
import { getPerson } from '@/lib/people';
import { useLedger } from '@/lib/use-ledger';

/** One shared item (decision 0026): what it is, where it stands on this side, and what the user can do next. */
export default function ItemDetail() {
  const colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const load = useCallback(async () => {
    const view = await getItem(id);
    const candidates = view && view.status === 'needs_link' && !view.settledOutside ? await candidatesFor(id).catch(() => []) : [];
    const bill = view ? await sameBill(view) : [];
    // Whether the person's balance still leans the way this item does, so settling makes sense.
    const person = view?.personId ? await getPerson(view.personId) : null;
    const open = person?.balances.find((b) => b.currency === view?.currency)?.amount ?? 0;
    const personOwes = view ? (view.flow === 'to_them' ? open > 0 : open < 0) : false;
    return { view, candidates, bill, personOwes };
  }, [id]);
  const { data } = useLedger(load, { view: null as ItemView | null, candidates: [] as LedgerTransaction[], bill: [] as ItemView[], personOwes: false });
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pickingCategory, setPickingCategory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = data.view;

  useEffect(() => {
    listAccountBalances().then((all) => setAccounts(all.filter((b) => b.account.type !== 'loan')));
  }, []);
  const mine = view?.mine ?? false;
  useEffect(() => {
    navigation.setOptions({
      title: view ? view.personName : '',
      // Decision 0028: changing an item opens a sheet from the pencil; only its creator can.
      headerRight: mine
        ? () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Change" hitSlop={8} onPress={() => startEditRef.current()} style={styles.headerButton}>
              <Feather name="edit-2" size={18} color={colors.text} />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, view, mine, colors, styles]);
  const startEditRef = useRef(() => {});

  if (!view) return null;
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const owedToMe = view.flow === 'to_them';
  const paidByThem = view.kind === 'share' && view.flow === 'to_me';
  // Something still owed that a repayment can settle (decision 0027).
  const canSettle =
    view.personId !== null &&
    (view.kind === 'loan' || view.kind === 'share') &&
    view.status !== 'declined' &&
    view.status !== 'needs_answer' &&
    data.personOwes;
  const inCurrency = view.currency === 'INR' ? accounts.filter((b) => b.currency === 'INR') : accounts.filter((b) => b.currency === view.currency);

  function startEdit() {
    setAmount(formatMoney(view!.amount, view!.currency, { symbol: false }).replace(/,/g, ''));
    setReason(view!.reason ?? '');
    setEditing(true);
  }
  startEditRef.current = startEdit;

  async function saveEdit() {
    const typed = parseMoney(amount, view!.currency);
    if (typed === null || typed <= 0) return setError('Enter the amount as a number above zero');
    await run(async () => {
      await updateItem(view!.id, { amount: paise(typed), reason: reason.trim() || null });
      setEditing(false);
    });
  }

  function confirmDelete() {
    Alert.alert(
      'Remove this?',
      view!.oneSided ? 'Your entry gets its category back.' : `${view!.personName} no longer sees it, and your entry gets its category back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => run(() => deleteItem(view!.id)).then(() => router.back()) },
      ],
    );
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <MoneyCard>
        <View style={styles.heroTop}>
          <Initial name={view.personName} size={44} />
          <View style={styles.grow}>
            <Text style={styles.heroLabel}>{itemTitle(view)}</Text>
            <Text style={styles.heroMeta}>{[view.reason, formatDate(`${view.occurredOn}T12:00:00`)].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
        <Text style={[styles.heroAmount, view.status !== 'declined' && owedToMe && { color: colors.heroAccent }, view.status === 'declined' && { color: colors.heroMuted }]}>
          {formatAmount(view.amount, view.currency)}
        </Text>
        <Text style={[styles.heroStatus, view.status === 'declined' && { color: colors.heroDanger }]}>{statusText(view)}</Text>
        {canSettle && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/settle?person=${view.personId}&item=${view.id}`)}
            style={({ pressed }) => [styles.heroButton, pressed && styles.pressedFade]}
          >
            <Text style={styles.heroButtonText}>Settle up</Text>
          </Pressable>
        )}
      </MoneyCard>
      {canSettle && (
        <Text style={styles.hint}>
          {owedToMe ? `Settle up when ${view.personName} pays you back, or you call it even.` : `Settle up when you pay ${view.personName} back, or you call it even.`}
        </Text>
      )}

      {view.status === 'needs_answer' && (
        <Card style={styles.card}>
          <Text style={styles.body}>
            {paidByThem
              ? `${view.personName} paid and says your share is ${formatAmount(view.amount, view.currency)}. Accepting adds it to your spending${view.categoryName ? ` on ${view.categoryName}` : ''} and to what you owe them. Your bank balance doesn't change.`
              : `${view.personName} says you paid for this and their share is ${formatAmount(view.amount, view.currency)}. Accepting asks you for the entry you paid with.`}
          </Text>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button title="Accept" loading={busy} onPress={() => run(() => answerItem(view.id, true))} />
            </View>
            <View style={styles.grow}>
              <Button title="Decline" variant="secondary" onPress={() => run(() => answerItem(view.id, false))} />
            </View>
          </View>
          {paidByThem && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPickingCategory(true)}>
              <Text style={styles.link}>Accept on another category</Text>
            </Pressable>
          )}
        </Card>
      )}

      {view.status === 'needs_link' && !view.settledOutside && (
        <>
          <SectionTitle>{view.kind === 'share' ? 'The entry you paid with' : view.flow === 'to_them' ? 'The payment you sent' : 'The payment you got'}</SectionTitle>
          {data.candidates.length > 0 ? (
            <Card>
              {data.candidates.map((tx, i) => (
                <Pressable
                  key={tx.id}
                  accessibilityRole="button"
                  onPress={() => run(() => linkEntry(view.id, tx.id))}
                  style={({ pressed }) => [styles.entry, i > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <View style={styles.grow}>
                    <Text style={styles.name}>{tx.counterparty ?? 'Payment'}</Text>
                    <Text style={styles.meta}>{formatDate(tx.occurredAt)} · tap to link</Text>
                  </View>
                </Pressable>
              ))}
            </Card>
          ) : (
            <Text style={styles.meta}>
              No entry fits yet. When it comes in by SMS or a statement, it shows up here, and links itself when the payee is {view.personName}. You can also open
              the entry and pick {view.kind === 'share' ? 'Split' : view.flow === 'to_them' ? 'I lent it or I paid back' : 'I borrowed it or Paid me back'}.
            </Text>
          )}
          {view.kind !== 'share' && inCurrency.length > 0 && (
            <>
              <Text style={styles.label}>Or add it by hand, for cash or an account without SMS</Text>
              <Chips>
                {inCurrency.map((b) => (
                  <Chip
                    key={b.account.id}
                    label={b.account.name}
                    selected={false}
                    onPress={() => run(() => recordEntry(view.id, b.account.id, new Date(`${view.occurredOn}T12:00:00`).toISOString()))}
                  />
                ))}
              </Chips>
            </>
          )}
        </>
      )}

      {data.bill.length > 0 && (
        <>
          <SectionTitle>Same bill</SectionTitle>
          <Card>
            {data.bill.map((v, i) => (
              <ItemRow key={v.id} view={{ ...v, reason: v.personName }} first={i === 0} />
            ))}
          </Card>
          {view.mine && <Text style={styles.hint}>Each person settles their own share. Changing one share doesn't change the others.</Text>}
        </>
      )}

      {view.transactionId && !view.settledOutside && (
        <Card>
          <LinkRow first icon="file-text" title="Open your entry" meta="The payment this is tied to" onPress={() => router.push(`/transaction/${view.transactionId}`)} />
        </Card>
      )}
      {view.transactionId && !view.settledOutside && !paidByThem && (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => run(() => unlinkEntry(view.id))} style={styles.quiet}>
          <Text style={styles.link}>That's not the right entry</Text>
        </Pressable>
      )}

      {view.mine && (
        <Text style={styles.hint}>
          {!view.oneSided
            ? `Only you can change it, from the pencil. A new amount asks ${view.personName} again.`
            : view.sharedWith
              ? `Shared with ${view.sharedWith} once they're your friend on Money Plant.`
              : `Only on your phone. Add ${view.personName}'s email to share it.`}
        </Text>
      )}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Change">
        <Field label={`Amount (${currencyInfo(view.currency).symbol.trim()})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Field label="What for" value={reason} onChangeText={setReason} maxLength={120} />
        {error && <ErrorText>{error}</ErrorText>}
        <Button title="Save" onPress={saveEdit} loading={busy} />
      </Sheet>
      {!view.mine && <Text style={styles.hint}>{view.personName} added this. Only they can change it.</Text>}

      {error && !editing && <ErrorText>{error}</ErrorText>}
      {view.mine && (
        <Pressable accessibilityRole="button" onPress={confirmDelete} style={styles.remove}>
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      )}

      <CategoryPicker
        visible={pickingCategory}
        flow="expense"
        onPick={(node) => {
          setPickingCategory(false);
          void run(() => answerItem(view.id, true, node.id));
        }}
        onClose={() => setPickingCategory(false)}
      />
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, paddingBottom: 48, gap: 8 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroLabel: { fontSize: 15, fontWeight: '600', color: colors.heroText },
  heroMeta: { fontSize: 12, color: colors.heroMuted, marginTop: 2 },
  heroAmount: { fontSize: 36, fontWeight: '700', color: colors.heroText, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroStatus: { fontSize: 13, fontWeight: '600', color: colors.heroMuted, marginTop: -8 },
  heroButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 14, backgroundColor: colors.heroAccent },
  heroButtonText: { fontSize: 15, fontWeight: '700', color: colors.hero },
  pressedFade: { opacity: 0.7 },
  quiet: { alignSelf: 'center', paddingVertical: 6 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, marginTop: 8 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
  meta: { fontSize: 13, color: colors.muted },
  card: { padding: 16, gap: 12 },
  body: { fontSize: 14, lineHeight: 20, color: colors.text },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  entry: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary, marginTop: 4 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 16, gap: 10 },
}));
