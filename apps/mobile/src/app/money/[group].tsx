import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import type { LocalHolding } from '@money-plant/db-schema';
import { accountIcon, accountLabel } from '@/components/account-picker';
import { formatAmount, formatDate, formatSummary } from '@/components/format';
import { MoneyCard, figures, radius, useColors, makeStyles } from '@/components/ui';
import { GROUPS, isGroupKey } from '@/lib/account-groups';
import { fetchNavHistory } from '@/lib/fund-chart';
import { fundValues, listHoldings, type FundValue } from '@/lib/funds';
import { homeCurrency } from '@/lib/home-currency';
import { homeValueOf, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const balances = await listAccountBalances();
  const [holdings, values] = await Promise.all([listHoldings(), fundValues(new Map(balances.map((b) => [b.account.id, b.balance])))]);
  return { balances, holdings, values };
}

const signedPercent = (gain: number, invested: number) => {
  if (invested <= 0) return null;
  const tenths = Math.round((gain * 1000) / invested);
  return `${tenths >= 0 ? '+' : '−'}${(Math.abs(tenths) / 10).toFixed(1)}%`;
};
// Funds are priced in rupees (decision 0017), whatever the home currency.
const signedRupees = (amount: number) => `${amount >= 0 ? '+' : '−'}${formatSummary(Math.abs(amount), 'INR')}`;

/** NW-4 (decision 0015): one group's accounts, opened from Accounts. Mutual funds get their own page (NW-3). */
export default function GroupPage() {
  const styles = useStyles();
  const { group: key } = useLocalSearchParams<{ group: string }>();
  const group = GROUPS.find((g) => g.key === key);
  const { data } = useLedger(load, { balances: [] as AccountBalance[], holdings: [] as LocalHolding[], values: new Map<string, FundValue>() }, 'group');
  if (!isGroupKey(key) || !group) return null;
  const rows = data.balances.filter(group.has).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (key === 'funds') return <Funds rows={rows} holdings={data.holdings} values={data.values} />;
  // NW-7: the group's total is in the home currency.
  const total = rows.reduce((s, b) => s + homeValueOf(b), 0);
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: group.title }} />
      <MoneyCard>
        <Text style={styles.heroMuted}>{group.key === 'debts' ? 'You owe' : 'Total'}</Text>
        <Text style={styles.heroAmount}>{formatSummary(Math.abs(total))}</Text>
      </MoneyCard>
      <View style={styles.card}>
        {rows.map((item, i) => (
          <AccountRow key={item.account.id} item={item} first={i === 0} />
        ))}
      </View>
      {rows.length === 0 && <Text style={styles.meta}>Nothing here yet.</Text>}
    </ScrollView>
  );
}

function AccountRow({ item, first }: { item: AccountBalance; first: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const { account, value, reconciliation, typeLabel, currency, homeValue } = item;
  const foreign = currency !== homeCurrency();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/account/${account.id}`)} style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <Feather name={accountIcon(account.type)} size={16} color={colors.secondary} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {accountLabel(account)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {typeLabel}
          {account.institution ? ` · ${account.institution}` : ''}
        </Text>
        {reconciliation?.flagged && <Text style={styles.warn}>Off from the bank by {formatAmount(Math.abs(reconciliation.latest.gap), currency)}</Text>}
      </View>
      <View style={styles.values}>
        <Text style={[styles.amount, value < 0 && { color: colors.danger }]}>{formatSummary(value, currency)}</Text>
        {foreign && homeValue !== null && <Text style={styles.meta}>{formatSummary(homeValue)}</Text>}
      </View>
    </Pressable>
  );
}

/** The next SIP date for a fund with a SIP on `day` of the month, today or later. */
function nextSip(day: number, from = new Date()): Date {
  const clamp = (y: number, m: number) => Math.min(day, new Date(y, m + 1, 0).getDate());
  const y = from.getFullYear();
  const m = from.getMonth();
  const thisMonth = new Date(y, m, clamp(y, m));
  if (thisMonth.getDate() >= from.getDate()) return thisMonth;
  return new Date(y, m + 1, clamp(y, m + 1));
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** NW-3 (decision 0015): value, invested, gain and return, the next SIPs, then each fund with its share. */
function Funds({ rows, holdings, values }: { rows: AccountBalance[]; holdings: LocalHolding[]; values: Map<string, FundValue> }) {
  const colors = useColors();
  const styles = useStyles();
  useEffect(() => {
    fetchNavHistory().catch(() => {});
  }, []);
  const funds = rows
    .map((b) => ({ balance: b, holding: holdings.find((h) => h.accountId === b.account.id) ?? null, value: values.get(b.account.id) ?? null }))
    .sort((a, b) => (b.value?.value ?? b.balance.value) - (a.value?.value ?? a.balance.value));
  const worth = funds.reduce((s, f) => s + (f.value?.value ?? f.balance.value), 0);
  const gain = funds.reduce((s, f) => s + (f.value?.gain ?? 0), 0);
  const invested = worth - gain;
  const sips = funds.filter((f) => f.holding?.sipPaise && f.holding.sipDay && f.holding.unitsE4 > 0);
  const soonest = sips.map((f) => nextSip(f.holding!.sipDay!).getTime()).sort((a, b) => a - b)[0];
  const due = soonest === undefined ? [] : sips.filter((f) => nextSip(f.holding!.sipDay!).getTime() === soonest);
  const casDate = holdings.map((h) => h.asOf).sort().pop();
  const navDate = [...values.values()].map((v) => v.navDate).filter((d): d is string => !!d).sort().pop();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Mutual funds',
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={() => router.push('/cas-import')} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Import CAS</Text>
            </Pressable>
          ),
        }}
      />
      <MoneyCard>
        <Text style={styles.heroMuted}>Current value</Text>
        <Text style={styles.heroAmount}>{formatSummary(worth, 'INR')}</Text>
        <View style={styles.heroStats}>
          <Stat label="Invested" value={formatSummary(invested, 'INR')} />
          <Stat label="Gain" value={signedRupees(gain)} tone={gain >= 0 ? 'in' : 'out'} />
          <Stat label="Return" value={signedPercent(gain, invested) ?? '–'} tone={gain >= 0 ? 'in' : 'out'} />
        </View>
      </MoneyCard>

      {due.length > 0 && soonest !== undefined && (
        <View style={styles.banner}>
          <Feather name="calendar" size={18} color={colors.primary} />
          <Text style={styles.bannerText}>
            Next {due.length === 1 ? 'SIP' : 'SIPs'} on {new Date(soonest).getDate()} {SHORT_MONTHS[new Date(soonest).getMonth()]}:{' '}
            {due.length === 1 ? due[0]!.balance.account.name : `${due.length} funds`}, {formatAmount(due.reduce((s, f) => s + f.holding!.sipPaise!, 0), 'INR')}
          </Text>
        </View>
      )}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>
          {funds.length} {funds.length === 1 ? 'FUND' : 'FUNDS'}
        </Text>
        <Text style={styles.meta}>Sorted by value</Text>
      </View>
      <View style={styles.card}>
        {funds.map(({ balance, holding, value }, i) => {
          const now = value?.value ?? balance.value;
          const pct = value ? signedPercent(value.gain, value.value - value.gain) : null;
          return (
            <Pressable
              key={balance.account.id}
              accessibilityRole="button"
              onPress={() => router.push(`/account/${balance.account.id}`)}
              style={({ pressed }) => [styles.fund, i > 0 && styles.divided, pressed && styles.pressed]}
            >
              <View style={styles.fundTop}>
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {balance.account.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {holding?.sipPaise ? `SIP ${formatAmount(holding.sipPaise, 'INR')}` : holding?.unitsE4 === 0 ? 'Sold' : 'No SIP'}
                    {balance.account.institution ? ` · ${balance.account.institution}` : ''}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatSummary(now, 'INR')}</Text>
                  {pct && <Text style={[styles.pct, value!.gain < 0 && { color: colors.danger }]}>{pct}</Text>}
                </View>
              </View>
              <View style={styles.share}>
                <View style={[styles.shareFill, { width: `${worth > 0 ? Math.max(1, (now * 100) / worth) : 0}%` }]} />
              </View>
            </Pressable>
          );
        })}
      </View>
      {casDate && (
        <Text style={styles.footnote}>
          From your CAS of {formatDate(`${casDate}T12:00:00`)}
          {navDate ? ` · NAVs of ${formatDate(`${navDate}T12:00:00`)}` : ''}
        </Text>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.grow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone === 'in' && { color: colors.heroAccent }, tone === 'out' && { color: colors.heroDanger }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32, gap: 14 },
  heroMuted: { fontSize: 13, color: colors.heroMuted },
  heroAmount: { fontSize: 34, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroStats: { flexDirection: 'row', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.heroLine },
  statLabel: { fontSize: 12, color: colors.heroMuted },
  statValue: { fontSize: 15, fontWeight: '600', color: colors.heroText, marginTop: 2, ...figures },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.primarySurface },
  bannerText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10 },
  fund: { gap: 8, paddingVertical: 12 },
  fundTop: { flexDirection: 'row', gap: 12 },
  right: { alignItems: 'flex-end' },
  pct: { fontSize: 12, fontWeight: '600', color: colors.primary, marginTop: 2, ...figures },
  share: { height: 4, borderRadius: 2, backgroundColor: colors.track, overflow: 'hidden' },
  shareFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { opacity: 0.7 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  warn: { fontSize: 12, color: colors.warning, marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, ...figures },
  values: { alignItems: 'flex-end' },
  footnote: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  headerButton: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  headerButtonText: { fontSize: 13, fontWeight: '600', color: colors.text },
}));
