import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatMoney, paise } from '@money-plant/core';
import { REVIEW_REASON_LABELS } from '@money-plant/matcher';
import { describePattern, type PatternMatch, type Rule } from '@money-plant/categoriser';
import { SwipeRow } from '@/components/swipe-row';
import { Button, Card, radius, useColors, makeStyles } from '@/components/ui';
import { formatDate, formatDateTime, formatDay, formatTime, formatAmount, reviewTime } from '@/components/format';
import { displayAmount, transactionTitle } from '@/components/transaction-item';
import { whyLabel } from '@/components/why';
import { useCategoryChange } from '@/components/use-category-change';
import { Suggestion } from '@/components/recurring-rows';
import { categoryNames } from '@/lib/categories';
import { acceptPattern, confirmEntries, confirmEntry, declinePattern } from '@/lib/entries';
import {
  deleteTransaction,
  listAccountBalances,
  listTransactions,
  splitTransfer,
  adoptBankBalance,
  setCurrentBalance,
  type AccountBalance,
  type TransactionRow,
} from '@/lib/ledger';
import { itemGuesses, linkEntry, type ItemGuess } from '@/lib/shared';
import { listRecurring } from '@/lib/recurring';
import { listRules } from '@/lib/rules-store';
import type { RecurringPayment } from '@money-plant/matcher';
import { useLedger } from '@/lib/use-ledger';
import { acceptCardCredit, beforePayment, cardsInCredit, gapIsDue, recordUnrecorded, type CardInCredit } from '@/lib/cards';
import { captureQuestions, type CaptureQuestions } from '@/lib/senders';
import { CaptureQuestionCards } from '@/components/capture-questions';
import { useReviewTimer } from '@/lib/health';

interface Proposal {
  rule: Rule & { match: PatternMatch };
  text: string;
  category: string;
}

async function load() {
  const [pending, balances, rules, names, recurring, questions] = await Promise.all([
    listTransactions({ pendingOnly: true }),
    listAccountBalances(),
    listRules(),
    categoryNames(),
    listRecurring(),
    captureQuestions(),
  ]);
  const accountName = new Map(balances.map((b) => [b.account.id, b.account.name]));
  const proposals = rules
    .filter((r): r is Rule & { match: PatternMatch } => r.status === 'proposed' && r.match.kind === 'pattern')
    .map((rule) => ({
      rule,
      text: describePattern(rule.match, rule.match.accountId ? (accountName.get(rule.match.accountId) ?? null) : null),
      category: names.get(rule.categoryId) ?? 'a category',
    }));
  const suggested = recurring.filter((r) => r.status === 'proposed');
  const guesses = await itemGuesses(pending.map((r) => r.tx)).catch(() => new Map<string, ItemGuess>());
  const inCredit = await cardsInCredit(balances).catch(() => [] as CardInCredit[]);
  return { pending, gaps: balances.filter((b) => gapIsDue(b)), inCredit, proposals, suggested, guesses, questions };
}

/** The question for an entry that is probably the user's side of an item (decision 0026). */
function guessText(guess: ItemGuess): string {
  if (guess.kind === 'share') return `Is this what you paid for ${guess.name}'s share?`;
  if (guess.kind === 'loan') return guess.flow === 'to_them' ? `Is this the money you lent ${guess.name}?` : `Is this the money ${guess.name} lent you?`;
  return guess.flow === 'to_me' ? `Is this ${guess.name} paying you back?` : `Is this you paying ${guess.name} back?`;
}

/** LED-6 review inbox, with pattern proposals (CAT-8) and balance gaps from LED-7. */
export default function Review() {
  const colors = useColors();
  const styles = useStyles();
  useReviewTimer();
  const { data } = useLedger(
    load,
    {
      pending: [] as TransactionRow[],
      gaps: [] as AccountBalance[],
      inCredit: [] as CardInCredit[],
      proposals: [] as Proposal[],
      suggested: [] as RecurringPayment[],
      guesses: new Map<string, ItemGuess>(),
      questions: { senders: [] } as CaptureQuestions,
    },
    'review',
  );
  const { picker, change } = useCategoryChange();
  const [questionError, setQuestionError] = useState<string | null>(null);
  const nothing =
    data.gaps.length === 0 && data.inCredit.length === 0 && data.proposals.length === 0 && data.suggested.length === 0 && data.questions.senders.length === 0;

  return (
    <>
      {picker}
      <FlatList
        data={data.pending}
        keyExtractor={(row) => row.tx.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {data.pending.length > 0 && (
              <Text style={styles.count}>
                {data.pending.length} left · {reviewTime(data.pending.length)}
              </Text>
            )}
            <CaptureQuestionCards questions={data.questions} onError={setQuestionError} />
            {questionError && <Text style={styles.count}>{questionError}</Text>}
            {data.proposals.map((p) => (
              <PatternCard key={p.rule.id} proposal={p} />
            ))}
            {data.suggested.map((item) => (
              <Suggestion key={item.id} item={item} />
            ))}
            {(data.gaps.length > 0 || data.inCredit.length > 0) && <Gaps gaps={data.gaps} inCredit={data.inCredit} />}
            <BulkReview pending={data.pending} onChangeCategory={change} />
          </>
        }
        ListEmptyComponent={
          nothing ? (
            <View style={styles.done}>
              <View style={styles.doneIcon}>
                <Feather name="check" size={30} color={colors.primary} />
              </View>
              <Text style={styles.doneTitle}>All caught up</Text>
              <Text style={styles.doneText}>New entries from your bank SMS will show up here.</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => <ReviewCard row={item} guess={data.guesses.get(item.tx.id) ?? null} onChangeCategory={change} />}
      />
    </>
  );
}

function ReviewCard({
  row,
  guess,
  onChangeCategory,
}: {
  row: TransactionRow;
  /** IOU-4: someone with an open loan of exactly this amount. */
  guess: ItemGuess | null;
  onChangeCategory: (id: string, flow: 'expense' | 'income', merchant: string | null) => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { tx, legs } = row;
  const isTransfer = tx.kind === 'transfer';
  const amount = displayAmount(row, colors);
  const reason = tx.reviewReason ? REVIEW_REASON_LABELS[tx.reviewReason] : null;
  const why = whyLabel(tx, row.aiConfidence);
  const change = () => onChangeCategory(tx.id, tx.kind === 'income' ? 'income' : 'expense', tx.counterparty);
  const accept = () => confirmEntry(tx.id).catch((e) => Alert.alert("Couldn't save", String(e?.message ?? e)));
  const confirmRemove = () =>
    Alert.alert('Remove this entry?', 'Use this for messages that were not a real payment.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(tx.id) },
    ]);
  return (
    <SwipeRow
      acceptLabel={isTransfer ? 'Transfer' : 'Looks right'}
      onAccept={accept}
      otherLabel={isTransfer ? undefined : 'Remove'}
      onOther={isTransfer ? undefined : confirmRemove}
      otherDestructive
    >
      <Card style={styles.card}>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/transaction/${tx.id}`)} style={styles.top}>
          <View style={styles.grow}>
            <Text style={styles.title} numberOfLines={1}>
              {transactionTitle(row)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {!isTransfer && legs[0] ? `${legs[0].accountName} · ` : ''}
              {formatDay(tx.occurredAt)}, {formatTime(tx.occurredAt)}
            </Text>
          </View>
          <Text style={[styles.amount, { color: amount.color }]}>{amount.text}</Text>
        </Pressable>
        {!isTransfer && (
          <View style={styles.why}>
            <Text style={styles.category}>{row.category?.name ?? 'No category yet'}</Text>
            {(why || reason) && <Text style={styles.meta}>{[why, reason].filter(Boolean).join('. ')}</Text>}
          </View>
        )}
        {isTransfer && reason && <Text style={styles.meta}>{reason}</Text>}
        <View style={styles.actions}>
          <View style={styles.action}>
            {isTransfer ? (
              <Button
                title="Not a transfer"
                variant="secondary"
                onPress={() => splitTransfer(tx.id).catch((e) => Alert.alert("Couldn't split", String(e?.message ?? e)))}
              />
            ) : (
              <Button
                title={row.category ? 'Change' : 'Pick category'}
                variant="secondary"
                onPress={change}
              />
            )}
          </View>
          <View style={styles.action}>
            <Button title={isTransfer ? 'Yes, a transfer' : 'Looks right'} onPress={accept} />
          </View>
        </View>
        {guess && legs[0] && (
          <Pressable
            accessibilityRole="button"
            onPress={() => linkEntry(guess.itemId, tx.id).catch((e) => Alert.alert("Couldn't link it", String(e?.message ?? e)))}
            style={({ pressed }) => [styles.guess, pressed && styles.guessPressed]}
          >
            <Feather name="corner-down-left" size={16} color={colors.primary} />
            <Text style={styles.guessText}>{guessText(guess)}</Text>
          </Pressable>
        )}
        {/* IOU-1, IOU-4, SPL-1: a payment to or from a person is often a loan, a repayment or a shared bill. */}
        {tx.reviewReason === 'person' && legs[0] && !guess && (
          <View style={styles.links}>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/item/new?from=${tx.id}&kind=loan`)}>
              <Text style={styles.link}>{legs[0].amount < 0 ? 'I lent this' : 'I borrowed this'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/item/new?from=${tx.id}&kind=repayment`)}>
              <Text style={styles.link}>{legs[0].amount > 0 ? 'Paid me back' : 'I paid back'}</Text>
            </Pressable>
            {tx.kind === 'expense' && (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/split?from=${tx.id}`)}>
                <Text style={styles.link}>Split it</Text>
              </Pressable>
            )}
          </View>
        )}
        {!isTransfer && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={styles.quiet}
            onPress={confirmRemove}
          >
            <Text style={styles.quietText}>Not a real payment</Text>
          </Pressable>
        )}
      </Card>
    </SwipeRow>
  );
}

/** Review reasons a whole group can settle at once. The rest need a look at each entry. */
const BULK_REASONS = new Set(['person', 'pattern', 'category_unsure', 'low_confidence']);
const OLD_AFTER_DAYS = 30;
const SHOWN_GROUPS = 5;

interface PayeeGroup {
  key: string;
  title: string;
  rows: TransactionRow[];
  total: number;
  /** The category every entry shares, or null when they differ or have none. */
  category: string | null;
}

/** Groups pending entries by payee, so a backlog from the first import takes a few taps. */
function payeeGroups(pending: readonly TransactionRow[]): PayeeGroup[] {
  const groups = new Map<string, TransactionRow[]>();
  for (const row of pending) {
    if (row.tx.kind === 'transfer' || !row.tx.reviewReason || !BULK_REASONS.has(row.tx.reviewReason)) continue;
    const key = transactionTitle(row).trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .filter(([, rows]) => rows.length >= 2)
    .map(([key, rows]) => {
      const names = new Set(rows.map((r) => r.category?.name ?? null));
      return {
        key,
        title: transactionTitle(rows[0]!),
        rows,
        // In the home currency (decision 0017); an entry whose rate isn't known yet adds nothing.
        total: rows.reduce((sum, r) => sum + Math.abs(r.homeAmount ?? 0), 0),
        category: names.size === 1 ? [...names][0]! : null,
      };
    })
    .sort((a, b) => b.rows.length - a.rows.length);
}

/** Bulk review: whole payees at once, and a way to clear old imported entries. */
function BulkReview({
  pending,
  onChangeCategory,
}: {
  pending: TransactionRow[];
  onChangeCategory: (ids: string[], flow: 'expense' | 'income', merchant: string | null) => void;
}) {
  const styles = useStyles();
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => payeeGroups(pending), [pending]);
  const cutoff = new Date(Date.now() - OLD_AFTER_DAYS * 86_400_000).toISOString();
  const old = pending.filter(
    (r) => r.tx.occurredAt < cutoff && r.tx.kind !== 'transfer' && r.tx.reviewReason !== null && BULK_REASONS.has(r.tx.reviewReason),
  );
  if (groups.length === 0 && old.length < 2) return null;
  const shown = showAll ? groups : groups.slice(0, SHOWN_GROUPS);

  function confirmOld() {
    Alert.alert(
      `Confirm ${old.length} older entries?`,
      `Entries from before ${formatDate(cutoff)} are confirmed as they are. They stay in Activity, and any without a category counts as Uncategorised in Budgets. You can still change each one.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void confirmEntries(old.map((r) => r.tx.id)) },
      ],
    );
  }

  return (
    <View style={styles.bulk}>
      {groups.length > 0 && <Text style={styles.bulkTitle}>Review by payee</Text>}
      {shown.map((group) => {
        const ids = group.rows.map((r) => r.tx.id);
        const flow = group.rows[0]!.tx.kind === 'income' ? 'income' : 'expense';
        return (
          <Card key={group.key} style={styles.card}>
            <View style={styles.top}>
              <View style={styles.grow}>
                <Text style={styles.title} numberOfLines={1}>
                  {group.title}
                </Text>
                <Text style={styles.meta}>
                  {group.rows.length} entries · {formatAmount(group.total)} · {group.category ?? 'No category yet'}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button title="Category for all" variant="secondary" onPress={() => onChangeCategory(ids, flow, group.rows[0]!.tx.counterparty)} />
              </View>
              {group.category && (
                <View style={styles.action}>
                  <Button title="All look right" onPress={() => void confirmEntries(ids)} />
                </View>
              )}
            </View>
          </Card>
        );
      })}
      {groups.length > SHOWN_GROUPS && (
        <Pressable accessibilityRole="button" hitSlop={8} style={styles.quiet} onPress={() => setShowAll(!showAll)}>
          <Text style={styles.link}>{showAll ? 'Show fewer payees' : `Show ${groups.length - SHOWN_GROUPS} more payees`}</Text>
        </Pressable>
      )}
      {old.length >= 2 && (
        <View style={styles.gapCard}>
          <Text style={styles.gapTitle}>{old.length} entries are older than {OLD_AFTER_DAYS} days</Text>
          <Text style={styles.gapText}>Most of these came from importing your SMS history. Confirm them as they are and keep the inbox for new entries.</Text>
          <Button title={`Confirm ${old.length} older entries`} variant="secondary" onPress={confirmOld} />
        </View>
      )}
      {groups.length > 0 && <Text style={styles.bulkTitle}>One by one</Text>}
    </View>
  );
}

/** CAT-8: a pattern learned from the user's corrections, waiting for a yes or no. */
function PatternCard({ proposal }: { proposal: Proposal }) {
  const styles = useStyles();
  const [autoConfirm, setAutoConfirm] = useState(false);
  return (
    <View style={styles.patternCard}>
      <Text style={styles.gapTitle}>New pattern: {proposal.category}</Text>
      <Text style={styles.gapText}>
        You categorised several entries like this the same way: {proposal.text}. Use {proposal.category} for these from now on?
      </Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Confirm matches without asking</Text>
        <Switch value={autoConfirm} onValueChange={setAutoConfirm} />
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title="Use pattern" onPress={() => acceptPattern(proposal.rule.id, autoConfirm)} />
        </View>
        <View style={styles.action}>
          <Button title="No thanks" variant="secondary" onPress={() => declinePattern(proposal.rule.id)} />
        </View>
      </View>
    </View>
  );
}

/**
 * LED-7 and decision 0024: a balance that doesn't match what the bank or card
 * says. The user always chooses the fix: add the missing entries, record one
 * entry for what's missing, or only adjust the balance.
 */
function Gaps({ gaps, inCredit }: { gaps: AccountBalance[]; inCredit: CardInCredit[] }) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work()
      .catch((e) => Alert.alert("Couldn't fix the balance", String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };
  return (
    <View style={styles.gaps}>
      {gaps.map(({ account, reconciliation }) => {
        if (!reconciliation) return null;
        const { latest, windowStart } = reconciliation;
        const card = account.type === 'credit_card';
        const who = card ? 'the card' : 'the bank';
        const missing = latest.gap > 0 ? `${formatMoney(latest.gap, account.currency)} of money in` : `${formatMoney(-latest.gap, account.currency)} of ${card ? 'spending' : 'money out'}`;
        const limit = account.creditLimitPaise;
        return (
          <View key={account.id} style={styles.gapCard}>
            <Text style={styles.gapTitle}>{account.name} doesn't match {who}</Text>
            <Text style={styles.gapText}>
              {card ? 'The card owed' : 'The bank said'} {formatMoney(card ? -latest.anchor.balance : latest.anchor.balance, account.currency)} on {formatDateTime(latest.anchor.observedAt)}; the ledger has{' '}
              {formatMoney(card ? -latest.computed : latest.computed, account.currency)}. {missing} probably wasn't recorded
              {windowStart ? ` between ${formatDateTime(windowStart)} and ${formatDateTime(latest.anchor.observedAt)}` : ''}.
            </Text>
            {card && latest.gap > 0 && limit !== null && (
              <Button
                title={`My credit limit went up to ${formatMoney(limit + latest.gap, account.currency)}`}
                variant="secondary"
                disabled={busy}
                onPress={() => router.push(`/account/limit?id=${account.id}&suggest=${limit + latest.gap}${windowStart ? `&from=${encodeURIComponent(windowStart)}` : ''}`)}
              />
            )}
            <Button title="Add the missing entries" variant="secondary" disabled={busy} onPress={() => router.push(`/quick-add?account=${account.id}&at=${encodeURIComponent(latest.anchor.observedAt)}`)} />
            <Button
              title={latest.gap < 0 ? (card ? 'Record as unrecorded card spending' : 'Record as unrecorded spending') : 'Record as unrecorded money in'}
              variant="secondary"
              disabled={busy}
              onPress={() => run(() => recordUnrecorded(account.id, latest.gap, latest.anchor.observedAt))}
            />
            <Button title="Only adjust the balance" variant="secondary" disabled={busy} onPress={() => run(() => adoptBankBalance(account.id, latest.anchor))} />
          </View>
        );
      })}
      {inCredit.map(({ balance, paidAt }) => {
        const { account } = balance;
        const extra = formatMoney(balance.balance, account.currency);
        const at = beforePayment(paidAt);
        return (
          <View key={account.id} style={styles.gapCard}>
            <Text style={styles.gapTitle}>{account.name} shows {extra} in your favour</Text>
            <Text style={styles.gapText}>
              After your last payment the card is {extra} in credit. Usually that means {extra} of spending on the card that the app didn't see.
            </Text>
            <Button title="Add the missing entries" variant="secondary" disabled={busy} onPress={() => router.push(`/quick-add?account=${account.id}&at=${encodeURIComponent(at)}`)} />
            <Button title="Record as unrecorded card spending" variant="secondary" disabled={busy} onPress={() => run(() => recordUnrecorded(account.id, paise(-balance.balance), at))} />
            <Button title="Only set the balance to zero" variant="secondary" disabled={busy} onPress={() => run(() => setCurrentBalance(account.id, paise(0)))} />
            <Button title="The card really is in credit" variant="secondary" disabled={busy} onPress={() => run(() => acceptCardCredit(balance))} />
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 12 },
  count: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  card: { padding: 16, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
  amount: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  why: { alignItems: 'flex-start' },
  category: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.subtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary, paddingVertical: 4 },
  guess: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.subtle },
  guessPressed: { backgroundColor: colors.pressed },
  guessText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.primary },
  quiet: { alignSelf: 'center', paddingVertical: 4 },
  quietText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  done: { alignItems: 'center', gap: 10, marginTop: 96, paddingHorizontal: 40 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  doneText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  gaps: { gap: 12, marginBottom: 12 },
  bulk: { gap: 12, marginBottom: 12 },
  bulkTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 4 },
  gapCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 8 },
  patternCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.primarySurface, gap: 8, marginBottom: 12 },
  gapTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  gapText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 14, color: colors.text, flex: 1 },
}));
