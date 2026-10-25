import { useCallback, useState } from 'react';
import { AppState, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { formatMonth, formatWholeRupees, reviewTime } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import { Avatar, useMe } from '@/components/avatar';
import { ErrorText, ProgressBar, colors, radius } from '@/components/ui';
import { categoriseWithAi } from '@/lib/ai-categorise';
import { ensureDefaultCategories } from '@/lib/categories';
import { currentMonth, incomeThisMonth, monthOverview, type BudgetLine } from '@/lib/budgets';
import { fillMissingPayees, hasImportedInbox, importInbox } from '@/lib/capture';
import { countPending, listAccountBalances, listTransactions, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { displayName } from '@/lib/me';
import { owedSummary, refreshIous, type OwedSummary } from '@/lib/ious';
import { refreshDeposits } from '@/lib/deposits';
import { refreshFunds } from '@/lib/funds';
import { refreshRecurring } from '@/lib/recurring';
import { scheduleMonthReview } from '@/lib/review';
import { syncNow } from '@/lib/sync';
import { useLedger } from '@/lib/use-ledger';
import { weekAhead, type DueItem } from '@/lib/week';
import { hasSmsPermission, isSmsReaderAvailable } from '../../../modules/sms-reader';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function loadHome() {
  await ensureDefaultCategories();
  const month = currentMonth();
  const [balances, pending, imported, overview, income, week, recent, owed] = await Promise.all([
    listAccountBalances(),
    countPending(),
    hasImportedInbox(),
    monthOverview(month),
    incomeThisMonth(month),
    weekAhead(),
    listTransactions({ limit: 3 }),
    owedSummary(),
  ]);
  return { balances, pending, imported, month: overview.overall, outside: overview.outside, elapsed: overview.elapsed, income, week, recent, owed };
}

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** HOME-1: is this month on track, what needs a look, and where the money is. */
export default function Home() {
  const insets = useSafeAreaInsets();
  const { data, reload } = useLedger(loadHome, {
    balances: [] as AccountBalance[],
    pending: 0,
    imported: true,
    month: null as BudgetLine | null,
    outside: 0,
    elapsed: 0,
    income: 0,
    week: { days: [] as string[], items: [] as DueItem[] },
    recent: [] as TransactionRow[],
    owed: null as OwedSummary | null,
  });
  const me = useMe();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      // Catch up on SMS that arrived while the receiver couldn't run, then sync.
      if (isSmsReaderAvailable && hasSmsPermission() && (await hasImportedInbox())) await importInbox();
      // Payees a newer parser can now read, for entries captured before it (once per parser change).
      await fillMissingPayees().catch(() => 0);
      await syncNow();
      setError(null);
      // REC-1, REC-4: new debits mark payments paid, steady ones become suggestions, reminders follow.
      refreshRecurring().catch(() => {});
      // NW-2: RD instalments and FD payments become transfers into their deposits.
      refreshDeposits().catch(() => {});
      // NW-3: SIP debits become transfers into their funds; today's NAVs once a day.
      refreshFunds().catch(() => {});
      // BUD-4: the review notification for the 1st of next month.
      scheduleMonthReview().catch(() => {});
      // IOU-4: payments from people who owe the user settle their IOUs.
      refreshIous().catch(() => {});
      // CAT-2: only merchants that rules, patterns and the dictionary couldn't place; capped on the server.
      categoriseWithAi().catch(() => {});
    } catch (e) {
      setError(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
      reload();
    }
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => subscription.remove();
    }, [refresh]),
  );

  const smsReady = !isSmsReaderAvailable || (hasSmsPermission() && data.imported);
  const now = new Date();
  const flagged = data.balances.filter((b) => b.reconciliation?.flagged).length;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20 }]}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} progressViewOffset={insets.top} />}
      >
        <View style={styles.between}>
          <View style={styles.headerText}>
            <Text style={styles.date}>
              {DAYS[now.getDay()]}, {now.getDate()} {MONTHS[now.getMonth()]}
            </Text>
            <Text style={styles.hello} numberOfLines={1}>
              {greeting(now)}
              {me?.name ? `, ${displayName(me).split(' ')[0]}` : ''}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {Platform.OS === 'android' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan and pay"
                hitSlop={8}
                onPress={() => router.push('/pay')}
                style={({ pressed }) => [styles.scan, pressed && styles.pressed]}
              >
                <Feather name="maximize" size={18} color={colors.text} />
                <Text style={styles.scanText}>Pay</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" hitSlop={8} onPress={() => router.push('/settings')}>
              <Avatar me={me} />
            </Pressable>
          </View>
        </View>

        {!smsReady && (
          <Pressable accessibilityRole="button" style={styles.callout} onPress={() => router.push('/capture')}>
            <Text style={styles.calloutTitle}>Read your bank SMS</Text>
            <Text style={styles.calloutText}>
              Money Plant can fill your ledger from ICICI, HDFC, HSBC and SBI messages. The text stays on this phone.
            </Text>
          </Pressable>
        )}

        {data.month && <MonthCard line={data.month} outside={data.outside} income={data.income} elapsed={data.elapsed} />}

        {data.week.days.length > 0 && <WeekStrip days={data.week.days} items={data.week.items} />}

        {data.pending > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/review')}
            style={({ pressed }) => [styles.review, pressed && styles.pressed]}
          >
            <View style={styles.reviewCount}>
              <Text style={styles.reviewCountText}>{data.pending}</Text>
            </View>
            <View style={styles.grow}>
              <Text style={styles.rowTitle}>{data.pending === 1 ? 'Entry to review' : 'Entries to review'}</Text>
              <Text style={styles.meta}>{reviewTime(data.pending).replace(/^\w/, (c) => c.toUpperCase())}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}

        {flagged > 0 && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/accounts')} style={({ pressed }) => [styles.review, pressed && styles.pressed]}>
            <Feather name="alert-circle" size={20} color={colors.warning} />
            <Text style={[styles.rowTitle, styles.grow]}>
              {flagged === 1 ? '1 account is' : `${flagged} accounts are`} off from the bank
            </Text>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}

        {data.recent.length > 0 && (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push('/activity')}>
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            </View>
            {data.recent.map((row) => (
              <TransactionItem key={row.tx.id} row={row} showTime />
            ))}
          </View>
        )}

        {data.owed && (data.owed.owedToMe > 0 || data.owed.iOwe > 0 || data.owed.toConfirm > 0) && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/people')} style={({ pressed }) => [styles.owed, pressed && styles.pressed]}>
            <Feather name="users" size={18} color={colors.muted} />
            <Text style={[styles.owedText, styles.grow]} numberOfLines={2}>
              {[
                data.owed.owedToMe > 0 ? `Owed to you ${formatWholeRupees(data.owed.owedToMe)}` : null,
                data.owed.iOwe > 0 ? `You owe ${formatWholeRupees(data.owed.iOwe)}` : null,
                data.owed.toConfirm > 0 ? `${data.owed.toConfirm} to confirm` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        )}

        {error && <ErrorText>{error}</ErrorText>}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick add"
        onPress={() => router.push('/quick-add')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Feather name="plus" size={26} color={colors.onInk} />
      </Pressable>
    </View>
  );
}

/**
 * HOME-1, BUD-2: the month so far. Money in counts income categories only, so
 * transfers and repayments never inflate it. The tick marks an even pace.
 */
/**
 * HOME-1 and BUD-1: with budgets, the total budget (the sum of the category
 * budgets) against what was spent in those categories; without, money in
 * against all spending.
 */
function MonthCard({ line, outside, income, elapsed }: { line: BudgetLine; outside: number; income: number; elapsed: number }) {
  const status = line.pace?.status ?? 'ok';
  const month = currentMonth();
  const today = new Date();
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
  const pill = status === 'over' ? 'Over budget' : status === 'pace' ? 'Spending fast' : 'On track';
  const budgeted = line.limit !== null;
  const left = budgeted ? line.limit! - line.spent : income - line.spent;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/budgets')} style={({ pressed }) => [styles.month, pressed && styles.pressed]}>
      <View style={styles.between}>
        <Text style={styles.monthLabel}>{formatMonth(month).split(' ')[0]} so far</Text>
        {budgeted && <Text style={[styles.pill, status === 'ok' ? styles.pillOk : styles.pillWarn]}>{pill}</Text>}
      </View>
      <View style={styles.figures}>
        {budgeted ? (
          <Figure label="Budget" value={formatWholeRupees(line.limit!)} />
        ) : (
          <Figure label="Money in" value={formatWholeRupees(income)} color={income > 0 ? colors.primary : undefined} />
        )}
        <Figure label="Spent" value={formatWholeRupees(line.spent)} />
        <Figure label="Left" value={formatWholeRupees(left)} color={left < 0 ? colors.danger : undefined} />
      </View>
      {budgeted ? (
        <>
          <ProgressBar value={line.spent / line.limit!} status={status} marker={elapsed} />
          <Text style={styles.monthNote}>
            {status === 'over'
              ? `Over by ${formatWholeRupees(line.spent - line.limit!)}`
              : status === 'pace'
                ? `On pace for ${formatWholeRupees(line.pace!.projected)}`
                : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
            {outside > 0 ? ` · ${formatWholeRupees(outside)} spent outside your budgets` : ''}
          </Text>
        </>
      ) : (
        <Text style={styles.monthNote}>Tap to set budgets on the categories you want to track.</Text>
      )}
    </Pressable>
  );
}

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={[styles.figureValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** HOME-1: the next 7 days, with a dot on days that have a bill, EMI or IOU due, and what's due below. */
function WeekStrip({ days, items }: { days: string[]; items: DueItem[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const due = new Set(items.map((i) => i.date));
  const shown = selected ? items.filter((i) => i.date === selected) : items.slice(0, 3);
  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>This week</Text>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push('/recurring')}>
          <Text style={styles.sectionLink}>Bills and subscriptions</Text>
        </Pressable>
      </View>
      <View style={styles.week}>
        {days.map((day, i) => {
          const date = new Date(`${day}T12:00:00`);
          const on = selected === day;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${WEEKDAYS[date.getDay()]} ${date.getDate()}${due.has(day) ? ', something due' : ''}`}
              onPress={() => setSelected(on ? null : day)}
              style={[styles.weekDay, i === 0 && styles.weekToday, on && styles.weekOn]}
            >
              <Text style={[styles.weekName, on && styles.weekTextOn]}>{WEEKDAYS[date.getDay()]}</Text>
              <Text style={[styles.weekDate, on && styles.weekTextOn]}>{date.getDate()}</Text>
              <View style={[styles.dot, due.has(day) && styles.dotOn]} />
            </Pressable>
          );
        })}
      </View>
      {shown.length === 0 ? (
        <Text style={[styles.meta, styles.weekEmpty]}>{selected ? 'Nothing due that day.' : 'Nothing due this week.'}</Text>
      ) : (
        <View style={styles.dueList}>
          {shown.map((item) => {
            const date = new Date(`${item.date}T12:00:00`);
            return (
              <Pressable key={item.href} accessibilityRole="button" onPress={() => router.push(item.href)} style={({ pressed }) => [styles.dueRow, pressed && styles.pressed]}>
                <Text style={[styles.dueText, styles.grow]} numberOfLines={1}>
                  {item.overdue ? 'Overdue' : WEEKDAYS[date.getDay()]} · {item.title}
                </Text>
                <Text style={[styles.dueAmount, item.incoming && { color: colors.primary }]}>{formatWholeRupees(item.amount)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: 20, paddingBottom: 112, gap: 20 },
  date: { fontSize: 13, color: colors.muted },
  hello: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 2 },
  callout: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 4 },
  calloutTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  calloutText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  month: { padding: 20, borderRadius: 20, backgroundColor: colors.subtle, gap: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  // A long name is cut with "..." instead of pushing Pay and the avatar off the screen.
  headerText: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  scan: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: radius.pill, backgroundColor: colors.subtle },
  scanText: { fontSize: 14, fontWeight: '600', color: colors.text },
  monthLabel: { fontSize: 13, fontWeight: '500', color: colors.muted },
  pill: { fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  pillOk: { color: colors.primary, backgroundColor: colors.primarySurface },
  pillWarn: { color: colors.warning, backgroundColor: colors.warningSurface },
  monthNote: { fontSize: 13, color: colors.secondary, lineHeight: 19 },
  review: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  reviewCount: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  reviewCountText: { color: colors.onInk, fontWeight: '700', fontSize: 15 },
  grow: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.muted },
  sectionLink: { fontSize: 13, fontWeight: '600', color: colors.primary },
  figures: { flexDirection: 'row', gap: 12 },
  figure: { flex: 1, gap: 4 },
  figureValue: { fontSize: 20, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  week: { flexDirection: 'row', gap: 6 },
  weekDay: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.subtle },
  weekToday: { borderWidth: 1, borderColor: colors.primary },
  weekOn: { backgroundColor: colors.ink },
  weekName: { fontSize: 11, color: colors.muted },
  weekDate: { fontSize: 16, fontWeight: '600', color: colors.text },
  weekTextOn: { color: colors.onInk },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2, backgroundColor: 'transparent' },
  dotOn: { backgroundColor: colors.warning },
  weekEmpty: { marginTop: 10 },
  dueList: { marginTop: 8 },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  dueText: { fontSize: 14, color: colors.secondary },
  dueAmount: { fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  owed: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  owedText: { fontSize: 14, color: colors.text },
  pressed: { opacity: 0.85 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabPressed: { opacity: 0.85 },
});
