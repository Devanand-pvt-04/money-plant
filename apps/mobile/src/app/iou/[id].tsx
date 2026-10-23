import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { formatRupees, isDateKey, parseRupees } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { formatAmount, formatDate, formatDateTime } from '@/components/format';
import { dueText } from '@/components/people-rows';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, colors, radius } from '@/components/ui';
import {
  deleteIou,
  getIou,
  loanCandidates,
  payLink,
  recordRepayment,
  reminderMessage,
  respondToIou,
  updateIou,
  type EntryLink,
  type IouView,
} from '@/lib/ious';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { getMe } from '@/lib/me';
import { today } from '@/lib/recurring';
import { openUpiLink } from '@/lib/upi';
import { useLedger } from '@/lib/use-ledger';


/** One IOU: what is still owed, its repayments, and the ways to settle it (IOU-2 to IOU-5). */
export default function IouDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const load = useCallback(() => getIou(id), [id]);
  const { data: view } = useLedger(load, null as IouView | null);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [repaying, setRepaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAccountBalances().then(setAccounts);
  }, []);
  useEffect(() => {
    navigation.setOptions({ title: view ? view.otherName : 'IOU' });
  }, [navigation, view]);

  if (!view) return null;
  const day = today();
  const open = view.outstanding > 0 && view.state !== 'declined' && view.state !== 'awaiting_me';
  const link = payLink(view);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  async function share() {
    try {
      await Share.share({ message: reminderMessage(view!, await getMe()) });
    } catch (e) {
      fail(e);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Initial name={view.otherName} size={56} />
        <Text style={styles.title}>{view.direction === 'lent' ? `${view.otherName} owes you` : `You owe ${view.otherName}`}</Text>
        <Text style={[styles.heroAmount, view.direction === 'lent' && open && { color: colors.primary }]}>
          {formatAmount(view.state === 'awaiting_me' ? view.amount : view.outstanding)}
        </Text>
        <Text style={styles.meta}>
          {view.outstanding === 0 ? 'Settled' : view.outstanding !== view.amount ? `Left of ${formatAmount(view.amount)}` : (view.reason ?? '')}
          {dueText(view, day) ? ` · ${dueText(view, day)}` : ''}
        </Text>
      </View>

      {view.state === 'awaiting_me' && <Respond view={view} accounts={accounts} onError={fail} />}
      {view.state === 'declined' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {view.otherName} said this IOU is wrong. Talk to them, then delete it or record it again with the right details.
          </Text>
        </View>
      )}
      {view.state === 'awaiting_them' && (
        <Text style={styles.small}>
          Shared with {view.sharedWith}. They see it when they sign in to Money Plant with that email, and can confirm it.
        </Text>
      )}
      {view.state === 'confirmed' && <Text style={styles.small}>{view.otherName} confirmed this. Repayments either of you records show up for both.</Text>}

      {open && (
        <View style={styles.actions}>
          {view.direction === 'borrowed' &&
            (link ? (
              <Button title={`Pay ${formatAmount(view.outstanding)} with UPI`} onPress={() => openUpiLink(link).catch(fail)} />
            ) : (
              <Text style={styles.small}>Add {view.otherName}'s UPI ID on their page to pay them from here.</Text>
            ))}
          <Button title={view.direction === 'lent' ? 'Send a reminder' : 'Send a message'} variant={view.direction === 'lent' ? 'primary' : 'secondary'} onPress={share} />
          <Button title={repaying ? 'Cancel' : 'Record a repayment'} variant="secondary" onPress={() => setRepaying(!repaying)} />
          {repaying && <Repayment view={view} accounts={accounts} onDone={() => setRepaying(false)} onError={fail} />}
          <Text style={styles.small}>
            {view.direction === 'lent'
              ? `When ${view.otherName}'s payment shows up in your bank SMS, it is counted here.`
              : 'When your payment shows up in your bank SMS, it is counted here.'}
          </Text>
        </View>
      )}
      {error && <ErrorText>{error}</ErrorText>}

      {view.payments.length > 0 && (
        <>
          <SectionTitle>Repayments</SectionTitle>
          <Card style={styles.list}>
            {view.payments.map((p) => (
              <View key={p.id} style={styles.line}>
                <Text style={styles.lineText}>
                  {formatDateTime(p.paidAt)} · {p.byMe ? 'you recorded' : `${view.otherName} recorded`}
                </Text>
                <Text style={styles.lineAmount}>{formatAmount(p.amount)}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Details</SectionTitle>
      <Card style={styles.list}>
        <Text style={styles.lineText}>
          {view.direction === 'lent' ? 'Lent' : 'Borrowed'} {formatAmount(view.amount)} on {formatDate(`${view.occurredOn}T12:00:00`)}
        </Text>
        {view.reason && <Text style={styles.lineText}>For {view.reason}</Text>}
        {view.transactionId && (
          <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push(`/transaction/${view.transactionId}`)}>
            <Text style={styles.link}>See the ledger entry</Text>
          </Pressable>
        )}
        {view.personId && (
          <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push(`/person/${view.personId}`)}>
            <Text style={styles.link}>Everything with {view.otherName}</Text>
          </Pressable>
        )}
      </Card>

      {view.role === 'owner' && <OwnerEdit view={view} onError={fail} />}
    </ScrollView>
  );
}

/** IOU-2: the other person confirms an IOU shared with them, and says where the money is in their ledger. */
function Respond({ view, accounts, onError }: { view: IouView; accounts: AccountBalance[]; onError: (e: unknown) => void }) {
  const [candidates, setCandidates] = useState<LedgerTransaction[]>([]);
  const [link, setLink] = useState<EntryLink | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loanCandidates(view.direction, view.amount, view.occurredOn).then((found) => {
      setCandidates(found);
      if (found.length === 1) setLink({ existingId: found[0]!.id });
    });
  }, [view.direction, view.amount, view.occurredOn]);
  const key = (l: EntryLink | null) => (l === null ? 'none' : 'existingId' in l ? l.existingId : l.accountId);

  const answer = (accept: boolean) => async () => {
    if (accept && !link) return onError(new Error(view.direction === 'borrowed' ? 'Pick where the money came in' : 'Pick where the money went out from'));
    setBusy(true);
    try {
      await respondToIou(view.id, accept, accept ? link : null);
      if (!accept) router.back();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.respond}>
      <Text style={styles.bannerText}>
        {view.otherName} says {view.direction === 'borrowed' ? 'you borrowed' : 'you lent them'} {formatAmount(view.amount)}
        {view.reason ? ` for ${view.reason}` : ''} on {formatDate(`${view.occurredOn}T12:00:00`)}. Is that right?
      </Text>
      <Text style={styles.small}>{view.direction === 'borrowed' ? 'The money came into' : 'The money went out from'}</Text>
      <Chips>
        {candidates.map((tx) => (
          <Chip
            key={tx.id}
            label={`Entry: ${tx.counterparty ?? 'payment'}, ${formatDate(tx.occurredAt)}`}
            selected={key(link) === tx.id}
            onPress={() => setLink({ existingId: tx.id })}
          />
        ))}
        {accounts.map((b) => (
          <Chip key={b.account.id} label={b.account.name} selected={key(link) === b.account.id} onPress={() => setLink({ accountId: b.account.id })} />
        ))}
      </Chips>
      <Button title="Yes, confirm" onPress={answer(true)} loading={busy} />
      <Button title="No, this is wrong" variant="secondary" onPress={answer(false)} disabled={busy} />
    </View>
  );
}

/** IOU-4 by hand: cash, or an account the app doesn't read. */
function Repayment({ view, accounts, onDone, onError }: { view: IouView; accounts: AccountBalance[]; onDone: () => void; onError: (e: unknown) => void }) {
  const [amount, setAmount] = useState(formatRupees(view.outstanding, { symbol: false }).replace(/,/g, ''));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(today());
  const [busy, setBusy] = useState(false);
  async function save() {
    const parsed = parseRupees(amount);
    if (parsed === null || parsed <= 0) return onError(new Error('Enter the amount as a number above zero'));
    if (!accountId) return onError(new Error(view.direction === 'lent' ? 'Pick where the money came in' : 'Pick where you paid from'));
    if (!isDateKey(paidOn.trim())) return onError(new Error('Enter the date as YYYY-MM-DD'));
    setBusy(true);
    try {
      await recordRepayment(view.id, { amount: parsed, accountId, paidOn: paidOn.trim() });
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Text style={styles.label}>{view.direction === 'lent' ? 'Came into' : 'Paid from'}</Text>
      <Chips>
        {accounts.map((b) => (
          <Chip key={b.account.id} label={b.account.name} selected={accountId === b.account.id} onPress={() => setAccountId(b.account.id)} />
        ))}
      </Chips>
      <Field label="Date" value={paidOn} onChangeText={setPaidOn} autoCapitalize="none" />
      <Text style={styles.small}>Only for money the app didn't see in your SMS, so it isn't counted twice.</Text>
      <View style={styles.actions}>
        <Button title="Save repayment" onPress={save} loading={busy} />
      </View>
    </View>
  );
}

function OwnerEdit({ view, onError }: { view: IouView; onError: (e: unknown) => void }) {
  const [reason, setReason] = useState(view.reason ?? '');
  const [dueDate, setDueDate] = useState(view.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const changed = reason.trim() !== (view.reason ?? '') || dueDate.trim() !== (view.dueDate ?? '');
  async function save() {
    if (dueDate.trim() && !isDateKey(dueDate.trim())) return onError(new Error('Enter the due date as YYYY-MM-DD, or leave it empty'));
    setBusy(true);
    try {
      await updateIou(view.id, { reason, dueDate: dueDate.trim() || null });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <Field label="What for" value={reason} onChangeText={setReason} maxLength={200} />
      <Field label="Due date" value={dueDate} onChangeText={setDueDate} placeholder="2026-11-30" autoCapitalize="none" />
      {view.sharedWith && <Text style={styles.small}>A new due date asks {view.otherName} to confirm again.</Text>}
      <View style={styles.actions}>
        {changed && <Button title="Save changes" onPress={save} loading={busy} />}
        <Pressable
          accessibilityRole="button"
          style={styles.remove}
          onPress={() =>
            Alert.alert(
              'Delete this IOU?',
              view.payments.length > 0
                ? 'Its repayments stay in your ledger as payments to or from them.'
                : 'An entry you typed in for it is removed too. A bank SMS entry goes back to Review.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteIou(view.id).then(() => router.back(), onError) },
              ],
            )
          }
        >
          <Text style={styles.removeText}>Delete IOU</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 10, textAlign: 'center' },
  heroAmount: { fontSize: 40, fontWeight: '700', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  small: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  banner: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface },
  respond: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.subtle, gap: 12 },
  bannerText: { fontSize: 14, fontWeight: '500', color: colors.text, lineHeight: 20 },
  actions: { gap: 10, marginTop: 8 },
  list: { padding: 16, gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineText: { fontSize: 14, color: colors.text, flexShrink: 1 },
  lineAmount: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  link: { fontSize: 13, fontWeight: '600', color: colors.primary, marginTop: 4 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
