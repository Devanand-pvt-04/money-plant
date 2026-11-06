import { useCallback } from 'react';
import { AppState, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { formatMonth, formatWholeRupees, reviewTime } from '@/components/format';
import { SetupCard } from '@/components/setup-card';
import { TransactionItem } from '@/components/transaction-item';
import { Avatar, useMe } from '@/components/avatar';
import { ErrorText, MoneyCard, ProgressBar, colors, figures, radius } from '@/components/ui';
import { ensureDefaultCategories } from '@/lib/categories';
import { currentMonth, incomeThisMonth, monthOverview, type BudgetLine } from '@/lib/budgets';
import { hasImportedInbox } from '@/lib/capture';
import { countPending, listAccountBalances, listTransactions, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { displayName } from '@/lib/me';
import { owedSummary, type OwedSummary } from '@/lib/ious';
import { catchUpDue, usePullToRefresh } from '@/lib/refresh';
import { setupState, type SetupState } from '@/lib/setup';
import { useLedger } from '@/lib/use-ledger';
import { weekAhead, type DueItem } from '@/lib/week';
import { hasSmsPermission, isSmsReaderAvailable } from '../../../modules/sms-reader';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let categoriesReady = false;

async function loadHome() {
  if (!categoriesReady) {
    await ensureDefaultCategories();
    categoriesReady = true;
  }
  const month = currentMonth();
  const [balances, pending, imported, overview, income, week, recent, owed, setup] = await Promise.all([
    listAccountBalances(),
    countPending(),
    hasImportedInbox(),
    monthOverview(month),
    incomeThisMonth(month),
    weekAhead(),
    listTransactions({ limit: 3 }),
    owedSummary(),
    setupState().catch(() => null),
  ]);
  return { balances, pending, imported, month: overview.overall, outside: overview.outside, elapsed: overview.elapsed, income, week, recent, owed, setup };
}

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** HOME-1: is this month on track, what needs a look, and what's coming up (decision 0015). */
export default function Home() {
  const insets = useSafeAreaInsets();
  const { data, reload } = useLedger(
    loadHome,
    {
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
      setup: null as SetupState | null,
    },
    'home',
  );
  const me = useMe();
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);

  useFocusEffect(
    useCallback(() => {
      const catchUp = () => {
        if (catchUpDue()) void onRefresh();
      };
      catchUp();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') catchUp();
      });
      return () => subscription.remove();
    }, [onRefresh]),
  );

  const smsReady = !isSmsReaderAvailable || (hasSmsPermission() && data.imported);
  const now = new Date();
  const flagged = data.balances.filter((b) => b.reconciliation?.flagged).length;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={insets.top} />}
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
          <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" hitSlop={8} onPress={() => router.push('/settings')}>
            <Avatar me={me} />
          </Pressable>
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

        <Shortcuts pending={data.pending} />

        {data.setup && <SetupCard state={data.setup} onChange={reload} />}

        {flagged > 0 && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/accounts')} style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
            <Feather name="alert-circle" size={20} color={colors.warning} />
            <Text style={[styles.rowTitle, styles.grow]}>
              {flagged === 1 ? '1 account is' : `${flagged} accounts are`} off from the bank
            </Text>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}

        {data.week.days.length > 0 && <ComingUp items={data.week.items} />}

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
          <Pressable accessibilityRole="button" onPress={() => router.push('/people')} style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
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
 * HOME-1 and BUD-1, on the money card. With budgets: what's left of the total
 * budget (the sum of the category budgets), with a tick at an even pace.
 * Without: what was spent. Money in counts income categories only, so
 * transfers and repayments never inflate it.
 */
function MonthCard({ line, outside, income, elapsed }: { line: BudgetLine; outside: number; income: number; elapsed: number }) {
  const status = line.pace?.status ?? 'ok';
  const monthName = formatMonth(currentMonth()).split(' ')[0];
  const today = new Date();
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
  const budgeted = line.limit !== null;
  const left = budgeted ? line.limit! - line.spent : 0;
  const pill = status === 'over' ? 'Over budget' : status === 'pace' ? 'Spending fast' : 'On track';
  const note = !budgeted
    ? 'Tap to set budgets on the categories you want to track.'
    : status === 'over'
      ? `Over by ${formatWholeRupees(line.spent - line.limit!)}`
      : status === 'pace'
        ? `On pace for ${formatWholeRupees(line.pace!.projected)}`
        : null;
  const outsideNote = budgeted && outside > 0 ? `${formatWholeRupees(outside)} spent outside your budgets` : null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/budgets')} style={({ pressed }) => pressed && styles.pressed}>
      <MoneyCard>
        <View style={styles.between}>
          <Text style={styles.heroLabel}>{budgeted ? `Left to spend in ${monthName}` : `Spent in ${monthName}`}</Text>
          {budgeted && <Text style={[styles.pill, status === 'ok' ? styles.pillOk : styles.pillWarn]}>{pill}</Text>}
        </View>
        <View style={styles.heroLine}>
          <Text style={[styles.heroValue, left < 0 && { color: colors.heroDanger }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatWholeRupees(budgeted ? left : line.spent)}
          </Text>
          {budgeted && <Text style={styles.heroOf}>of {formatWholeRupees(line.limit!)}</Text>}
        </View>
        {budgeted && <ProgressBar value={line.spent / line.limit!} status={status} marker={elapsed} onHero />}
        <View style={styles.stats}>
          {budgeted && <Stat label="Spent" value={formatWholeRupees(line.spent)} />}
          <Stat label="Money in" value={formatWholeRupees(income)} color={income > 0 ? colors.heroAccent : undefined} />
          <Stat label="Days left" value={String(daysLeft)} />
        </View>
        {(note || outsideNote) && <Text style={styles.heroNote}>{[note, outsideNote].filter(Boolean).join(' · ')}</Text>}
      </MoneyCard>
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** HOME-1: the four things a user starts from Home. Scan & pay needs the Android UPI hand-off. */
function Shortcuts({ pending }: { pending: number }) {
  // Adding an entry is the floating + on every tab, so it isn't repeated here.
  const items: { icon: FeatherName; label: string; href: '/pay' | '/review' | '/expense'; count?: number }[] = [
    ...(Platform.OS === 'android' ? [{ icon: 'maximize' as const, label: 'Scan & pay', href: '/pay' as const }] : []),
    { icon: 'check-square', label: 'Review', href: '/review', count: pending },
    { icon: 'users', label: 'Split', href: '/expense' },
  ];
  return (
    <View style={styles.shortcuts}>
      {items.map((item) => {
        const waiting = (item.count ?? 0) > 0;
        return (
          <Pressable
            key={item.href}
            accessibilityRole="button"
            accessibilityLabel={waiting ? `${item.label}, ${item.count} waiting` : item.label}
            onPress={() => router.push(item.href)}
            style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          >
            <View style={[styles.shortcutIcon, waiting && styles.shortcutWaiting]}>
              <Feather name={item.icon} size={22} color={waiting ? colors.warning : colors.text} />
            </View>
            {waiting && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.count! > 99 ? '99+' : item.count}</Text>
              </View>
            )}
            <Text style={styles.shortcutLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dueLabel(item: DueItem, todayKey: string, tomorrowKey: string): string {
  if (item.overdue) return 'Overdue';
  if (item.date === todayKey) return 'Today';
  if (item.date === tomorrowKey) return 'Tomorrow';
  const date = new Date(`${item.date}T12:00:00`);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

/** HOME-1: bills, EMIs and IOUs due in the next 7 days, as small cards to scroll sideways. */
function ComingUp({ items }: { items: DueItem[] }) {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const todayKey = key(now);
  const tomorrowKey = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Coming up</Text>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push('/recurring')}>
          <Text style={styles.sectionLink}>All</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Text style={styles.meta}>Nothing due this week.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dueCards} style={styles.dueScroll}>
          {items.map((item) => {
            const label = dueLabel(item, todayKey, tomorrowKey);
            const soon = item.overdue || item.date === todayKey || item.date === tomorrowKey;
            return (
              <Pressable
                key={item.href}
                accessibilityRole="button"
                onPress={() => router.push(item.href)}
                style={({ pressed }) => [styles.dueCard, pressed && styles.pressed]}
              >
                <Text style={[styles.dueWhen, soon && { color: colors.warning }]}>{label}</Text>
                <Text style={styles.dueTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.dueAmount, item.incoming && { color: colors.primary }]}>{formatWholeRupees(item.amount)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: 16, paddingBottom: 112, gap: 20 },
  date: { fontSize: 13, color: colors.muted },
  hello: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 2, letterSpacing: -0.3 },
  callout: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 4 },
  calloutTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  calloutText: { fontSize: 13, color: colors.secondary, lineHeight: 19 },
  // A long name is cut with "..." instead of pushing the avatar off the screen.
  headerText: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  heroLabel: { flexShrink: 1, fontSize: 13, fontWeight: '500', color: colors.heroMuted },
  heroLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heroValue: { flexShrink: 1, fontSize: 40, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroOf: { fontSize: 14, color: colors.heroMuted, ...figures },
  heroNote: { fontSize: 13, color: colors.heroMuted, lineHeight: 19 },
  pill: { fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  pillOk: { color: colors.heroAccent, backgroundColor: colors.heroPill },
  pillWarn: { color: colors.heroWarning, backgroundColor: 'rgba(240,163,94,0.16)' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, gap: 2 },
  statLabel: { fontSize: 12, color: colors.heroMuted },
  statValue: { fontSize: 16, fontWeight: '600', color: colors.heroText, ...figures },
  shortcuts: { flexDirection: 'row', justifyContent: 'space-around' },
  shortcut: { flex: 1, alignItems: 'center', gap: 6 },
  shortcutIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutWaiting: { borderColor: colors.warningSurface, backgroundColor: colors.warningSurface },
  shortcutLabel: { fontSize: 12, fontWeight: '500', color: colors.text },
  badge: {
    position: 'absolute',
    top: -4,
    left: '50%',
    marginLeft: 14,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.onInk, ...figures },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  grow: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  sectionLink: { fontSize: 13, fontWeight: '600', color: colors.primary },
  // The cards run to the screen's edges while scrolling.
  dueScroll: { marginHorizontal: -16 },
  dueCards: { gap: 10, paddingHorizontal: 16 },
  dueCard: {
    width: 140,
    padding: 12,
    gap: 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dueWhen: { fontSize: 12, fontWeight: '600', color: colors.muted },
  dueTitle: { fontSize: 14, fontWeight: '500', color: colors.text },
  dueAmount: { fontSize: 16, fontWeight: '700', color: colors.text, ...figures },
  owedText: { fontSize: 14, color: colors.text },
  pressed: { opacity: 0.85 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabPressed: { opacity: 0.85 },
});
