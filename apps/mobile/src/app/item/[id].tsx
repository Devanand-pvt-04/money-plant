import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { currencyInfo, formatMoney, paise, parseMoney } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { CategoryPicker } from '@/components/category-picker';
import { formatAmount, formatDate } from '@/components/format';
import { FormScroll } from '@/components/keyboard';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, makeStyles, useColors } from '@/components/ui';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';
import {
  answerItem,
  candidatesFor,
  deleteItem,
  getItem,
  itemTitle,
  linkEntry,
  recordEntry,
  statusText,
  unlinkEntry,
  updateItem,
  type ItemView,
} from '@/lib/shared';
import { useLedger } from '@/lib/use-ledger';

/** One shared item (decision 0026): what it is, where it stands on this side, and what the user can do next. */
export default function ItemDetail() {
  const colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const load = useCallback(async () => {
    const view = await getItem(id);
    const candidates = view && view.status === 'needs_link' ? await candidatesFor(id).catch(() => []) : [];
    return { view, candidates };
  }, [id]);
  const { data } = useLedger(load, { view: null as ItemView | null, candidates: [] as LedgerTransaction[] });
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
  useEffect(() => {
    navigation.setOptions({ title: view ? view.personName : '' });
  }, [navigation, view]);

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
  const inCurrency = view.currency === 'INR' ? accounts.filter((b) => b.currency === 'INR') : accounts.filter((b) => b.currency === view.currency);

  function startEdit() {
    setAmount(formatMoney(view!.amount, view!.currency, { symbol: false }).replace(/,/g, ''));
    setReason(view!.reason ?? '');
    setEditing(true);
  }

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
      <View style={styles.hero}>
        <Initial name={view.personName} size={56} />
        <Text style={styles.title}>{itemTitle(view)}</Text>
        <Text style={[styles.heroAmount, view.status !== 'declined' && { color: owedToMe ? colors.primary : colors.text }]}>{formatAmount(view.amount, view.currency)}</Text>
        <Text style={styles.meta}>
          {[view.reason, formatDate(`${view.occurredOn}T12:00:00`)].filter(Boolean).join(' · ')}
        </Text>
        <Text style={[styles.status, view.status === 'declined' && { color: colors.danger }]}>{statusText(view)}</Text>
      </View>

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

      {view.status === 'needs_link' && (
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

      {view.transactionId && (
        <View style={styles.actions}>
          <Button title="Open your entry" variant="secondary" onPress={() => router.push(`/transaction/${view.transactionId}`)} />
          {!paidByThem && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => run(() => unlinkEntry(view.id))}>
              <Text style={styles.link}>That's not the right entry</Text>
            </Pressable>
          )}
        </View>
      )}

      {view.mine && !editing && (
        <View style={styles.actions}>
          <Button title="Change" variant="secondary" onPress={startEdit} />
          <Button title="Remove" variant="secondary" onPress={confirmDelete} />
          {!view.oneSided && <Text style={styles.hint}>Only you can change it. A new amount asks {view.personName} again.</Text>}
          {view.oneSided && (
            <Text style={styles.hint}>
              {view.sharedWith ? `Shared with ${view.sharedWith} once they're your friend on Money Plant.` : `Only on your phone. Add ${view.personName}'s email to share it.`}
            </Text>
          )}
        </View>
      )}
      {editing && (
        <>
          <Field label={`Amount (${currencyInfo(view.currency).symbol.trim()})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="What for" value={reason} onChangeText={setReason} maxLength={120} />
          <View style={styles.actions}>
            <Button title="Save" onPress={saveEdit} loading={busy} />
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
          </View>
        </>
      )}
      {!view.mine && <Text style={styles.hint}>{view.personName} added this. Only they can change it.</Text>}

      {error && <ErrorText>{error}</ErrorText>}

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
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 12 },
  title: { fontSize: 15, color: colors.secondary, marginTop: 8, textAlign: 'center' },
  heroAmount: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 13, color: colors.muted },
  status: { fontSize: 13, fontWeight: '600', color: colors.secondary, marginTop: 4 },
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
