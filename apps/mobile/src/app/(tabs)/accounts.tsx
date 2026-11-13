import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lentBorrowed } from '@money-plant/core';
import Feather from '@expo/vector-icons/Feather';
import { formatAmount, formatSummary } from '@/components/format';
import { ErrorText, MoneyCard, figures, radius, useColors, makeStyles } from '@/components/ui';
import { GROUPS, SLICE_COLOURS, SLICE_LABELS, type AccountGroup } from '@/lib/account-groups';
import { marketValues } from '@/lib/demat';
import { fundValues } from '@/lib/funds';
import { homeValueOf, listAccountBalances, missingRates, type AccountBalance } from '@/lib/ledger';
import { netWorthHistory, owedWorth, totalNetWorth, type NetWorthPoint, type Owed } from '@/lib/networth';
import { recurringOverview, type UpcomingPayment } from '@/lib/recurring';
import { usePullToRefresh } from '@/lib/refresh';
import { useLedger } from '@/lib/use-ledger';

/** Gain on what was put in, for funds and stocks, so each group's line can say how it's doing. */
async function gains(balances: readonly AccountBalance[]) {
  const map = new Map(balances.map((b) => [b.account.id, b.balance]));
  const [funds, market] = await Promise.all([fundValues(map), marketValues(map)]);
  const total = (values: Iterable<{ gain: number | null; invested: number }>) => {
    let gain = 0;
    let invested = 0;
    for (const v of values) {
      if (v.gain === null) continue;
      gain += v.gain;
      invested += v.invested;
    }
    return invested > 0 ? { gain, invested } : null;
  };
  return {
    funds: total([...funds.values()].map((v) => ({ gain: v.gain, invested: v.value - v.gain }))),
    stocks: total([...market.values()]),
  };
}

async function load() {
  const [balances, owed] = await Promise.all([listAccountBalances(), owedWorth()]);
  const [recurring, history, gain] = await Promise.all([recurringOverview(), netWorthHistory(balances, owed), gains(balances)]);
  return { balances, owed, upcoming: recurring.upcoming, history, gain };
}

const percent = (gain: number, invested: number) => {
  const tenths = Math.round((gain * 1000) / invested);
  return `${tenths >= 0 ? '+' : '−'}${(Math.abs(tenths) / 10).toFixed(1)}%`;
};

/** NAV-1, NW-1, NW-4 (decision 0015): net worth, where it sits, and one row per group. */
export default function Accounts() {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { data, reload } = useLedger(
    load,
    { balances: [] as AccountBalance[], owed: NO_OWED, upcoming: [] as UpcomingPayment[], history: [] as NetWorthPoint[], gain: { funds: null, stocks: null } as Awaited<ReturnType<typeof gains>> },
    'accounts',
  );
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);
  const counted = data.balances.filter((b) => b.inNetWorth);
  // NW-7: totals are in the home currency.
  const own = counted.filter((b) => homeValueOf(b) > 0).reduce((s, b) => s + homeValueOf(b), 0);
  const owe = counted.filter((b) => homeValueOf(b) < 0).reduce((s, b) => s - homeValueOf(b), 0);
  const unrated = missingRates(data.balances);
  // NW-1: money lent counts as owned and money borrowed as owed.
  const { owed } = data;
  const worth = totalNetWorth(data.balances, owed);
  const showOwed = owed.lent > 0 || owed.borrowed > 0 || owed.leftOut > 0;
  const previous = data.history.length >= 2 ? data.history[data.history.length - 2]!.value : null;
  const change = previous === null ? null : worth - previous;
  const next = data.upcoming[0];

  // Where the money sits: what each slice owns, of everything owned.
  const slices = new Map<AccountGroup['slice'], number>();
  for (const b of counted) {
    if (homeValueOf(b) <= 0) continue;
    const slice = GROUPS.find((g) => g.has(b))?.slice ?? 'rest';
    slices.set(slice, (slices.get(slice) ?? 0) + homeValueOf(b));
  }
  const parts = (['funds', 'bank', 'stocks', 'deposits', 'rest'] as const)
    .map((slice) => ({ slice, value: slices.get(slice) ?? 0 }))
    .filter((p) => p.value > 0);

  const groups = GROUPS.map((group) => {
    const rows = data.balances.filter(group.has);
    return { group, rows, total: rows.reduce((s, b) => s + homeValueOf(b), 0) };
  }).filter((g) => g.rows.length > 0);

  const status = (group: AccountGroup, rows: AccountBalance[]): { text: string; tone: 'in' | 'warn' | 'muted' } => {
    if (group.key === 'funds' && data.gain.funds) return { text: `${percent(data.gain.funds.gain, data.gain.funds.invested)} overall`, tone: data.gain.funds.gain >= 0 ? 'in' : 'warn' };
    if (group.key === 'stocks' && data.gain.stocks) return { text: `${percent(data.gain.stocks.gain, data.gain.stocks.invested)} overall`, tone: data.gain.stocks.gain >= 0 ? 'in' : 'warn' };
    const flagged = rows.find((b) => b.reconciliation?.flagged);
    if (flagged) {
      return {
        text: `${flagged.account.institution ?? flagged.account.name} off by ${formatAmount(Math.abs(flagged.reconciliation!.latest.gap), flagged.account.currency)}`,
        tone: 'warn',
      };
    }
    if (group.key === 'debts') {
      const due = data.upcoming.find((u) => rows.some((b) => b.account.id === u.item.accountId));
      if (due) return { text: `${due.item.name} due ${due.overdue ? 'now' : formatDue(due.days)}`, tone: due.overdue ? 'warn' : 'muted' };
    }
    if (group.key === 'bank' && rows.some((b) => b.reconciliation)) return { text: rows.length === 1 ? 'Matches the bank' : `${rows.length} accounts, all match the bank`, tone: 'muted' };
    return { text: rows.length === 1 ? rows[0]!.account.name : `${rows.length} accounts`, tone: 'muted' };
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={insets.top} />}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          Accounts
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Add account" onPress={() => router.push('/add-account')} style={styles.roundButton}>
          <Feather name="plus" size={20} color={colors.text} />
        </Pressable>
      </View>
      {error && <ErrorText>{error}</ErrorText>}

      <MoneyCard style={styles.hero}>
        <View style={styles.between}>
          <Text style={styles.heroMuted}>Net worth</Text>
          {change !== null && change !== 0 && (
            <Text style={[styles.heroChange, change < 0 && { color: colors.heroDanger }]}>
              {change > 0 ? '+' : '−'}
              {formatSummary(Math.abs(change))} this month
            </Text>
          )}
        </View>
        <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
          {formatSummary(worth)}
        </Text>
        {unrated.length > 0 && (
          <Text style={styles.heroMuted}>
            Leaves out {unrated.map((b) => b.account.name).join(', ')} until today's exchange rate loads
          </Text>
        )}
        {own > 0 && parts.length > 0 && (
          <>
            <View style={styles.bar} accessible accessibilityLabel={`Where it sits: ${parts.map((p) => `${SLICE_LABELS[p.slice]} ${Math.round((p.value * 100) / own)}%`).join(', ')}`}>
              {parts.map((p) => (
                <View key={p.slice} style={{ flex: p.value, backgroundColor: SLICE_COLOURS[p.slice] }} />
              ))}
            </View>
            <View style={styles.legend}>
              {parts.map((p) => (
                <View key={p.slice} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: SLICE_COLOURS[p.slice] }]} />
                  <Text style={styles.legendText} numberOfLines={1}>
                    {SLICE_LABELS[p.slice]} {Math.round((p.value * 100) / own)}%
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </MoneyCard>

      <View style={styles.pair}>
        <View style={styles.tile}>
          <Text style={styles.meta}>You own</Text>
          <Text style={styles.tileValue}>{formatSummary(own + owed.lent)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.meta}>You owe</Text>
          <Text style={styles.tileValue}>{formatSummary(owe + owed.borrowed)}</Text>
        </View>
      </View>

      {groups.length === 0 && !showOwed ? (
        <Text style={styles.empty}>No accounts yet. Read your bank SMS, or add accounts, cards and cash by hand. Import your mutual funds from a CAS.</Text>
      ) : (
        <View style={styles.card}>
          {groups.map(({ group, rows, total }, i) => {
            const line = status(group, rows);
            return (
              <Pressable
                key={group.key}
                accessibilityRole="button"
                onPress={() => router.push(rows.length === 1 && group.key !== 'funds' ? `/account/${rows[0]!.account.id}` : `/money/${group.key}`)}
                style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
              >
                <View
                  style={[
                    styles.dot,
                    group.key === 'debts' ? styles.dotHollow : { backgroundColor: group.slice === 'rest' ? colors.track : SLICE_COLOURS[group.slice] },
                  ]}
                />
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {group.title}
                  </Text>
                  <Text style={[styles.status, line.tone === 'in' && styles.statusIn, line.tone === 'warn' && styles.statusWarn]} numberOfLines={1}>
                    {line.text}
                  </Text>
                </View>
                <Text style={styles.amount}>{total < 0 ? `−${formatSummary(-total)}` : formatSummary(total)}</Text>
              </Pressable>
            );
          })}
          {showOwed && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/people')}
              style={({ pressed }) => [styles.row, groups.length > 0 && styles.divided, pressed && styles.pressed]}
            >
              <View style={[styles.dot, owed.net < 0 ? styles.dotHollow : { backgroundColor: colors.track }]} />
              <View style={styles.grow}>
                <Text style={styles.name} numberOfLines={1}>
                  Lent and borrowed
                </Text>
                <Text style={styles.status} numberOfLines={1}>
                  {owedLine(owed)}
                </Text>
              </View>
              <Text style={styles.amount}>{owed.net < 0 ? `−${formatSummary(-owed.net)}` : formatSummary(owed.net)}</Text>
            </Pressable>
          )}
        </View>
      )}

      {data.history.length >= 2 && (
        <View style={styles.tileWide}>
          <Text style={styles.sectionTitle}>Net worth by month</Text>
          <History points={data.history} />
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={() => router.push('/cas-import')} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <Feather name="trending-up" size={18} color={colors.muted} />
        <View style={styles.grow}>
          <Text style={styles.name}>Import investments</Text>
          <Text style={styles.meta}>Funds from a CAS, shares and NPS from an NSDL or CDSL statement</Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.muted} />
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push('/recurring')} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <Feather name="repeat" size={18} color={colors.muted} />
        <View style={styles.grow}>
          <Text style={styles.name}>Recurring payments</Text>
          <Text style={styles.meta}>
            {next ? `${data.upcoming.length} active · next ${next.item.name} ${formatAmount(next.item.amount, next.item.currency)}` : 'Autopays, EMIs and subscriptions'}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.muted} />
      </Pressable>
    </ScrollView>
  );
}

const NO_OWED: Owed = { ...lentBorrowed([]), counted: [] };

/** "Lent ₹5,000 · Borrowed ₹2,000 · ₹1,000 left out". */
function owedLine(owed: Owed): string {
  const parts = [`Lent ${formatSummary(owed.lent)}`, `Borrowed ${formatSummary(owed.borrowed)}`];
  if (owed.leftOut > 0) parts.push(`${formatSummary(owed.leftOut)} left out`);
  return parts.join(' · ');
}

function formatDue(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** NW-4: net worth at the end of each recent month, as bars scaled between the lowest and highest month. */
function History({ points }: { points: NetWorthPoint[] }) {
  const colors = useColors();
  const styles = useStyles();
  const values = points.map((p) => p.value);
  const low = Math.min(0, ...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  return (
    <View style={styles.history} accessible accessibilityLabel={`Net worth by month: ${points.map((p) => `${MONTH_NAMES[Number(p.month.slice(5)) - 1]} ${formatSummary(p.value)}`).join(', ')}`}>
      {points.map((p, i) => {
        const last = i === points.length - 1;
        return (
          <View key={p.month} style={styles.historyColumn}>
            <View style={styles.historyTrack}>
              <View
                style={[
                  styles.historyBar,
                  { height: `${Math.max(4, ((p.value - low) / span) * 100)}%` },
                  { backgroundColor: p.value < 0 ? colors.danger : last ? colors.primary : colors.track },
                ]}
              />
            </View>
            <Text style={[styles.historyLabel, last && styles.historyLabelOn]}>{MONTH_NAMES[Number(p.month.slice(5)) - 1]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 16, paddingBottom: 48, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { gap: 12, paddingVertical: 18 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  heroMuted: { fontSize: 13, color: colors.heroMuted },
  heroChange: { fontSize: 13, fontWeight: '600', color: colors.heroAccent, ...figures },
  heroAmount: { fontSize: 36, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  bar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  legendItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.heroMuted, ...figures },
  pair: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tileValue: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2, ...figures },
  tileWide: { padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.muted },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { opacity: 0.7 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotHollow: { borderWidth: 2, borderColor: colors.muted },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  status: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statusIn: { color: colors.primary, fontWeight: '500' },
  statusWarn: { color: colors.warning, fontWeight: '500' },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, ...figures },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20, marginVertical: 8 },
  history: { flexDirection: 'row', gap: 8, height: 72 },
  historyColumn: { flex: 1, alignItems: 'center', gap: 4 },
  historyTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  historyBar: { width: '100%', borderRadius: 4 },
  historyLabel: { fontSize: 11, color: colors.muted },
  historyLabelOn: { color: colors.text, fontWeight: '600' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
}));
