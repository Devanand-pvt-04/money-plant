import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { REVIEW_REASON_LABELS } from '@money-plant/matcher';
import { describePattern, type PatternMatch, type Rule } from '@money-plant/categoriser';
import type { RecurringPayment } from '@money-plant/matcher';
import { SwipeRow } from '@/components/swipe-row';
import { Button, Initial, MoneyCard, ProgressBar, figures, radius, useColors, makeStyles } from '@/components/ui';
import { formatDate, formatDay, formatTime, formatAmount, reviewTime } from '@/components/format';
import { displayAmount, transactionTitle } from '@/components/transaction-item';
import { whyLabel } from '@/components/why';
import { useCategoryChange } from '@/components/use-category-change';
import { QuestionsPanel, questionCount, type Proposal } from '@/components/review-rows';
import { categoryNames } from '@/lib/categories';
import { confirmEntries, confirmEntry } from '@/lib/entries';
import { deleteTransaction, listAccountBalances, listTransactions, splitTransfer, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { itemGuesses, linkEntry, type ItemGuess } from '@/lib/shared';
import { listRecurring } from '@/lib/recurring';
import { listRules } from '@/lib/rules-store';
import { useLedger } from '@/lib/use-ledger';
import { cardsInCredit, gapIsDue, type CardInCredit } from '@/lib/cards';
import { captureQuestions, type CaptureQuestions } from '@/lib/senders';
import { useReviewTimer } from '@/lib/health';

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

/** Review reasons a whole group can settle at once. The rest need a look at each entry. */
const BULK_REASONS = new Set(['person', 'pattern', 'category_unsure', 'low_confidence']);
const OLD_AFTER_DAYS = 30;

type Filter = 'all' | 'questions' | 'payee' | 'older';

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

/** An entry that can be confirmed with the others: it has a category and nothing else to ask. */
function readyToConfirm(row: TransactionRow, guesses: Map<string, ItemGuess>): boolean {
  return row.tx.kind !== 'transfer' && row.category !== null && row.tx.reviewReason !== 'person' && !guesses.has(row.tx.id);
}

type ListItem = { kind: 'day'; key: string; label: string } | { kind: 'row'; key: string; row: TransactionRow; first: boolean; last: boolean };

/** Entries grouped by day, each day one card (decision 0028). */
function byDay(rows: readonly TransactionRow[]): ListItem[] {
  const items: ListItem[] = [];
  let day: string | null = null;
  rows.forEach((row, i) => {
    const label = formatDay(row.tx.occurredAt);
    if (label !== day) {
      day = label;
      items.push({ kind: 'day', key: `day:${label}:${i}`, label });
    }
    const next = rows[i + 1];
    items.push({ kind: 'row', key: row.tx.id, row, first: items[items.length - 1]?.kind === 'day', last: !next || formatDay(next.tx.occurredAt) !== label });
  });
  return items;
}

/** LED-6 review inbox (decision 0028): a money card, filters, questions as rows, entries as compact rows by day. */
export default function Review() {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
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
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const questions = questionCount(data);
  const groups = useMemo(() => payeeGroups(data.pending), [data.pending]);
  const cutoff = new Date(Date.now() - OLD_AFTER_DAYS * 86_400_000).toISOString();
  const old = data.pending.filter(
    (r) => r.tx.occurredAt < cutoff && r.tx.kind !== 'transfer' && r.tx.reviewReason !== null && BULK_REASONS.has(r.tx.reviewReason),
  );
  const ready = data.pending.filter((r) => readyToConfirm(r, data.guesses));
  const withCategory = data.pending.filter((r) => r.category !== null).length;

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: data.pending.length },
    { key: 'questions', label: 'Questions', count: questions },
    { key: 'payee', label: 'By payee', count: groups.length },
    { key: 'older', label: 'Older', count: old.length >= 2 ? old.length : 0 },
  ];
  // A filter that empties falls back to All.
  const active = filter !== 'all' && filters.find((f) => f.key === filter)!.count === 0 ? 'all' : filter;

  const rows = active === 'older' ? old : active === 'all' ? data.pending : [];
  const items = byDay(rows);
  const nothing = data.pending.length === 0 && questions === 0;

  function confirmReady() {
    Alert.alert(
      `Confirm ${ready.length} entries?`,
      'Every entry that already has a category is confirmed as it is. Payments to people and anything with a question stay here.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void confirmEntries(ready.map((r) => r.tx.id)) },
      ],
    );
  }

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

  const header = (
    <View style={styles.header}>
      {data.pending.length > 0 && (
        <MoneyCard>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>Left to check</Text>
              <Text style={styles.heroCount}>{data.pending.length}</Text>
            </View>
            <View style={styles.heroSide}>
              <Text style={styles.heroLabel}>{reviewTime(data.pending.length)}</Text>
              {withCategory > 0 && (
                <Text style={styles.heroAccent}>
                  {withCategory === data.pending.length ? 'All have' : `${withCategory} already ${withCategory === 1 ? 'has' : 'have'}`} a category
                </Text>
              )}
            </View>
          </View>
          <ProgressBar value={withCategory / data.pending.length} onHero />
        </MoneyCard>
      )}
      {filters.filter((f) => f.count > 0).length > 1 && (
        <View style={styles.filters}>
          {filters
            .filter((f) => f.key === 'all' || f.count > 0)
            .map((f) => (
              <Pressable
                key={f.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: active === f.key }}
                onPress={() => setFilter(f.key)}
                style={[styles.pill, active === f.key && styles.pillOn]}
              >
                <Text style={[styles.pillText, active === f.key && styles.pillTextOn]}>
                  {f.label} {f.count}
                </Text>
              </Pressable>
            ))}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {(active === 'all' || active === 'questions') && <QuestionsPanel data={data} onError={setError} />}
      {active === 'payee' && <PayeeGroups groups={groups} onChangeCategory={change} />}
      {active === 'older' && (
        <View style={styles.oldCard}>
          <Text style={styles.oldTitle}>
            {old.length} entries are older than {OLD_AFTER_DAYS} days
          </Text>
          <Text style={styles.oldText}>Most came from importing your SMS history. Confirm them as they are and keep the inbox for new entries.</Text>
          <Button title={`Confirm ${old.length} older entries`} onPress={confirmOld} />
        </View>
      )}
    </View>
  );

  const showBar = active === 'all' && ready.length >= 2;

  return (
    <>
      {picker}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[styles.list, showBar && { paddingBottom: 96 + insets.bottom }]}
        ListHeaderComponent={header}
        ListFooterComponent={
          items.length > 0 ? <Text style={styles.hint}>Swipe right to confirm · swipe left if it wasn't a real payment</Text> : undefined
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
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Text style={styles.day}>{item.label}</Text>
          ) : (
            <ReviewRow row={item.row} first={item.first} last={item.last} guess={data.guesses.get(item.row.tx.id) ?? null} onChangeCategory={change} />
          )
        }
      />
      {showBar && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 16 }]}>
          <Button title={`Confirm the ${ready.length} with a category`} onPress={confirmReady} />
        </View>
      )}
    </>
  );
}

/** One entry waiting for a look: a compact row with its category chip and a one-tap check (decision 0028). */
function ReviewRow({
  row,
  first,
  last,
  guess,
  onChangeCategory,
}: {
  row: TransactionRow;
  first: boolean;
  last: boolean;
  /** IOU-4: someone with an open item of exactly this amount. */
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
  const title = transactionTitle(row);
  const change = () => onChangeCategory(tx.id, tx.kind === 'income' ? 'income' : 'expense', tx.counterparty);
  const accept = () => confirmEntry(tx.id).catch((e) => Alert.alert("Couldn't save", String(e?.message ?? e)));
  const confirmRemove = () =>
    Alert.alert('Remove this entry?', 'Use this for messages that were not a real payment.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(tx.id) },
    ]);
  const person = tx.reviewReason === 'person' && legs[0] && !guess;
  const meta = [!isTransfer && legs[0] ? legs[0].accountName : null, formatTime(tx.occurredAt), why ?? reason].filter(Boolean).join(' · ');
  return (
    <View style={[styles.rowWrap, first && styles.rowFirst, last && styles.rowLast]}>
      <SwipeRow
        acceptLabel={isTransfer ? 'Transfer' : 'Looks right'}
        onAccept={accept}
        otherLabel={isTransfer ? undefined : 'Remove'}
        onOther={isTransfer ? undefined : confirmRemove}
        otherDestructive
      >
        <View style={[styles.row, !first && styles.divided]}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the entry"
            onPress={() => router.push(`/transaction/${tx.id}`)}
            onLongPress={isTransfer ? undefined : confirmRemove}
            style={styles.main}
          >
            <Initial name={title} />
            <View style={styles.grow}>
              <View style={styles.titleLine}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[styles.amount, { color: amount.color }]}>{amount.text}</Text>
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
          </Pressable>
          <View style={styles.chips}>
            {isTransfer ? (
              <Chip label="Not a transfer" onPress={() => splitTransfer(tx.id).catch((e) => Alert.alert("Couldn't split", String(e?.message ?? e)))} />
            ) : row.category ? (
              <Chip label={row.category.name} caret onPress={change} />
            ) : (
              <Chip label="Pick category" caret tone="warning" onPress={change} />
            )}
            {person && (
              <>
                <Chip label={legs[0]!.amount < 0 ? 'I lent this' : 'I borrowed this'} tone="primary" onPress={() => router.push(`/item/new?from=${tx.id}&kind=loan`)} />
                <Chip label={legs[0]!.amount > 0 ? 'Paid me back' : 'I paid back'} tone="primary" onPress={() => router.push(`/item/new?from=${tx.id}&kind=repayment`)} />
                {tx.kind === 'expense' && <Chip label="Split" tone="primary" onPress={() => router.push(`/split?from=${tx.id}`)} />}
              </>
            )}
            <View style={styles.grow} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isTransfer ? 'Yes, a transfer' : 'Looks right'}
              hitSlop={4}
              onPress={accept}
              style={({ pressed }) => [styles.check, (row.category || isTransfer) && styles.checkReady, pressed && styles.checkPressed]}
            >
              <Feather name="check" size={18} color={row.category || isTransfer ? colors.primary : colors.muted} />
            </Pressable>
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
        </View>
      </SwipeRow>
    </View>
  );
}

function Chip({ label, onPress, caret, tone }: { label: string; onPress: () => void; caret?: boolean; tone?: 'warning' | 'primary' }) {
  const colors = useColors();
  const styles = useStyles();
  const color = tone === 'warning' ? colors.warning : tone === 'primary' ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, tone === 'warning' && styles.chipWarning, tone === 'primary' && styles.chipPrimary, pressed && styles.chipPressed]}
    >
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {caret && <Feather name="chevron-down" size={13} color={color} />}
    </Pressable>
  );
}

/** Bulk review: whole payees at once. */
function PayeeGroups({
  groups,
  onChangeCategory,
}: {
  groups: PayeeGroup[];
  onChangeCategory: (ids: string[], flow: 'expense' | 'income', merchant: string | null) => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.groupCard}>
      {groups.map((group, i) => {
        const ids = group.rows.map((r) => r.tx.id);
        const flow = group.rows[0]!.tx.kind === 'income' ? 'income' : 'expense';
        return (
          <View key={group.key} style={[styles.row, i > 0 && styles.divided]}>
            <View style={styles.main}>
              <Initial name={group.title} />
              <View style={styles.grow}>
                <View style={styles.titleLine}>
                  <Text style={styles.title} numberOfLines={1}>
                    {group.title}
                  </Text>
                  <Text style={styles.amount}>{formatAmount(group.total)}</Text>
                </View>
                <Text style={styles.meta}>{group.rows.length} entries</Text>
              </View>
            </View>
            <View style={styles.chips}>
              <Chip
                label={group.category ?? 'Category for all'}
                caret
                tone={group.category ? undefined : 'warning'}
                onPress={() => onChangeCategory(ids, flow, group.rows[0]!.tx.counterparty)}
              />
              <View style={styles.grow} />
              {group.category && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`All ${group.rows.length} look right`}
                  hitSlop={4}
                  onPress={() => void confirmEntries(ids)}
                  style={({ pressed }) => [styles.check, styles.checkReady, pressed && styles.checkPressed]}
                >
                  <Feather name="check" size={18} color={colors.primary} />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  header: { gap: 12, marginBottom: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroLabel: { fontSize: 12, color: colors.heroMuted },
  heroCount: { fontSize: 34, fontWeight: '700', color: colors.heroText, ...figures },
  heroSide: { alignItems: 'flex-end', gap: 2, paddingBottom: 6 },
  heroAccent: { fontSize: 12, fontWeight: '600', color: colors.heroAccent },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.text },
  pillTextOn: { color: colors.onInk },
  error: { fontSize: 13, color: colors.danger },
  day: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 16, marginBottom: 6, marginHorizontal: 4 },
  rowWrap: { backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  row: { paddingHorizontal: 14, paddingVertical: 12, gap: 8, backgroundColor: colors.surface },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  main: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text, ...figures },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 52 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: colors.subtle, maxWidth: 200 },
  chipWarning: { backgroundColor: colors.warningSurface },
  chipPrimary: { backgroundColor: colors.primarySurface, borderRadius: radius.pill },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  check: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkReady: { borderColor: colors.primary },
  checkPressed: { backgroundColor: colors.primarySurface },
  guess: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.subtle, marginLeft: 52 },
  guessPressed: { backgroundColor: colors.pressed },
  guessText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.primary },
  groupCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  oldCard: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8 },
  oldTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  oldText: { fontSize: 14, color: colors.secondary, lineHeight: 20 },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 16 },
  done: { alignItems: 'center', gap: 10, marginTop: 96, paddingHorizontal: 40 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  doneText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
}));
