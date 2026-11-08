import { useEffect } from 'react';
import { Alert, FlatList, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { formatRupees, isBalanceScheme, monthOf, paise, SCHEMES, type Paise, type SchemeKind } from '@money-plant/core';
import type { LocalDeposit, LocalHolding } from '@money-plant/db-schema';
import { accountLabel } from '@/components/account-picker';
import { LineChart } from '@/components/line-chart';
import { Button, MoneyCard, colors, figures, radius } from '@/components/ui';
import { formatAmount, formatDate, formatDay, formatTime, formatWholeRupees } from '@/components/format';
import { TransactionItem } from '@/components/transaction-item';
import { deleteAccount } from '@/lib/accounts';
import { depositValue, getDeposit } from '@/lib/deposits';
import { fetchNavHistory, fundPage, type FundPage } from '@/lib/fund-chart';
import { fundValues, listHoldings, type FundValue } from '@/lib/funds';
import { marketValues, type MarketAccountValue } from '@/lib/demat';
import { adoptBankBalance, listAccountBalances, listTransactions, type AccountBalance, type TransactionRow } from '@/lib/ledger';
import { recurringOverview, type UpcomingPayment } from '@/lib/recurring';
import { useLedger } from '@/lib/use-ledger';

async function load(id: string) {
  const [balances, rows, deposit, holdings, recurring] = await Promise.all([
    listAccountBalances(),
    listTransactions({ accountId: id, limit: 100 }),
    getDeposit(id),
    listHoldings(),
    recurringOverview(),
  ]);
  const balance = balances.find((b) => b.account.id === id) ?? null;
  const holding = holdings.find((h) => h.accountId === id) ?? null;
  const fund = holding && balance ? { holding, value: (await fundValues(new Map([[id, balance.balance]]))).get(id)! } : null;
  const page = holding && balance ? await fundPage(id, balance.balance) : null;
  const market = balance && (balance.account.type === 'stock' || balance.account.type === 'nps') ? ((await marketValues(new Map([[id, balance.balance]]))).get(id) ?? null) : null;
  const upcoming = recurring.upcoming.filter((u) => u.item.accountId === id);
  return { balance, rows, deposit, fund, page, market, upcoming };
}

type Fund = { holding: LocalHolding; value: FundValue } | null;

const EMPTY = {
  balance: null as AccountBalance | null,
  rows: [] as TransactionRow[],
  deposit: null as LocalDeposit | null,
  fund: null as Fund,
  page: null as FundPage | null,
  market: null as MarketAccountValue | null,
  upcoming: [] as UpcomingPayment[],
};

/** NW-3, LED-7 (decision 0015): one account. Funds and bank accounts have pages of their own. */
export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useLedger(() => load(id), EMPTY, 'account');
  if (!data.balance) return null;
  const { account } = data.balance;

  function confirmDelete() {
    Alert.alert('Delete account?', `${account.name} will be removed from all your devices.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(account.id).then(() => router.back()) },
    ]);
  }
  const footer = (
    <View style={styles.footer}>
      <Button title="Delete account" variant="secondary" onPress={confirmDelete} />
    </View>
  );

  if (account.type === 'mutual_fund' && data.fund && data.page) return <FundView balance={data.balance} fund={data.fund} page={data.page} footer={footer} />;
  if (account.type === 'bank') return <BankView balance={data.balance} rows={data.rows} upcoming={data.upcoming} footer={footer} />;
  return <GenericView data={data} footer={footer} />;
}

function GenericView({ data, footer }: { data: typeof EMPTY; footer: React.ReactElement }) {
  const { account, balance, value, reconciliation, typeLabel } = data.balance!;
  const isDeposit = account.type === 'fd' || account.type === 'rd' || account.type === 'savings_scheme';
  const passbook = !!data.deposit && isBalanceScheme(data.deposit.kind);
  return (
    <FlatList
      data={data.rows}
      keyExtractor={(row) => row.tx.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: account.name }} />
          <MoneyCard>
            <Text style={styles.heroMuted}>
              {typeLabel}
              {account.institution ? ` · ${account.institution}` : ''}
              {account.last4 ? ` · ••${account.last4}` : ''}
            </Text>
            <Text style={styles.heroAmount}>{formatRupees(value)}</Text>
            {reconciliation && <Reconciled reconciliation={reconciliation} />}
          </MoneyCard>
          {isDeposit && <DepositCard accountId={account.id} deposit={data.deposit} balance={balance} value={value} />}
          {data.fund && <FundCard fund={data.fund} balance={balance} />}
          {data.market && <HoldingsCard market={data.market} />}
          <View style={styles.actions}>
            {((!data.deposit && !data.fund && !data.market) || passbook) && (
              <PillButton title={passbook ? 'Update from passbook' : 'Set balance'} onPress={() => router.push(`/account/balance?id=${account.id}`)} />
            )}
            {reconciliation?.flagged && <PillButton title="Use bank's balance" onPress={() => adoptBankBalance(account.id, reconciliation.latest.anchor)} />}
          </View>
          <Text style={styles.section}>ENTRIES</Text>
        </View>
      }
      ListEmptyComponent={<Text style={styles.meta}>No entries yet.</Text>}
      ListFooterComponent={footer}
      renderItem={({ item }) => <TransactionItem row={item} />}
    />
  );
}

function PillButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.pill, pressed && styles.pressedCard]}>
      <Text style={styles.pillText}>{title}</Text>
    </Pressable>
  );
}

/** "8:43 pm" for today, "3 Nov" before. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString() ? formatTime(iso) : formatDate(iso).replace(/ \d{4}$/, d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`);
}

/** LED-7: whether the ledger matches the latest balance the bank reported, by SMS or statement. */
function Reconciled({ reconciliation }: { reconciliation: NonNullable<AccountBalance['reconciliation']> }) {
  const { flagged, latest } = reconciliation;
  const said = `the bank's ${latest.anchor.from === 'statement' ? 'statement' : 'SMS'} of ${when(latest.anchor.observedAt)}`;
  return (
    <View style={styles.reconciled}>
      <Feather name={flagged ? 'alert-circle' : 'check'} size={14} color={flagged ? colors.heroWarning : colors.heroAccent} />
      <Text style={[styles.reconciledText, flagged && { color: colors.heroWarning }]}>
        {flagged
          ? `Off by ${formatRupees(paise(Math.abs(latest.gap)))} from ${said}`
          : `Matches ${said}`}
      </Text>
    </View>
  );
}

const legOf = (row: TransactionRow, id: string) => row.legs.find((l) => l.accountId === id)?.amount ?? 0;

/** LED-7 (decision 0015): balance, whether it matches the bank, this month's flows, what it pays, and its entries by day. */
function BankView({ balance: item, rows, upcoming, footer }: { balance: AccountBalance; rows: TransactionRow[]; upcoming: UpcomingPayment[]; footer: React.ReactElement }) {
  const { account, balance, reconciliation } = item;
  const month = monthOf(new Date());
  let moneyIn = 0;
  let moneyOut = 0;
  for (const row of rows) {
    if (monthOf(new Date(row.tx.occurredAt)) !== month) continue;
    const amount = legOf(row, account.id);
    if (amount > 0) moneyIn += amount;
    else moneyOut -= amount;
  }
  // Entries by day, newest first, each day with the balance at its end.
  const sections: { title: string; after: number; data: TransactionRow[] }[] = [];
  let running: number = balance;
  for (const row of [...rows].sort((a, b) => b.tx.occurredAt.localeCompare(a.tx.occurredAt))) {
    const title = formatDay(row.tx.occurredAt);
    let section = sections[sections.length - 1];
    if (!section || section.title !== title) {
      section = { title, after: running, data: [] };
      sections.push(section);
    }
    section.data.push(row);
    running -= legOf(row, account.id);
  }
  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.tx.id}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: accountLabel(account) }} />
          <MoneyCard>
            <Text style={styles.heroMuted}>Balance</Text>
            <Text style={styles.heroAmount}>{formatWholeRupees(balance)}</Text>
            {reconciliation && <Reconciled reconciliation={reconciliation} />}
            <View style={styles.heroStats}>
              <View style={styles.grow}>
                <Text style={styles.heroMuted}>In this month</Text>
                <Text style={[styles.heroStat, { color: colors.heroAccent }]}>+{formatWholeRupees(moneyIn)}</Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.heroMuted}>Out this month</Text>
                <Text style={styles.heroStat}>−{formatWholeRupees(moneyOut)}</Text>
              </View>
            </View>
          </MoneyCard>
          <View style={styles.actions}>
            <PillButton title="Set balance" onPress={() => router.push(`/account/balance?id=${account.id}`)} />
            <PillButton title="Import statement" onPress={() => router.push(`/statement-import?account=${account.id}`)} />
          </View>
          {reconciliation?.flagged && (
            <View style={styles.actions}>
              <PillButton title="Use the bank's balance" onPress={() => adoptBankBalance(account.id, reconciliation.latest.anchor)} />
            </View>
          )}
          {upcoming.length > 0 && (
            <View style={styles.paidFrom}>
              <Text style={styles.section}>PAID FROM HERE</Text>
              <View style={styles.chips}>
                {upcoming.map((u) => (
                  <Pressable key={u.item.id} accessibilityRole="button" onPress={() => router.push(`/recurring/${u.item.id}`)} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {u.item.name} {formatWholeRupees(u.item.amount)} · {ordinal(Number(u.item.nextDue.slice(8, 10)))}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.day}>
          <Text style={styles.dayText}>{section.title.toUpperCase()}</Text>
          <Text style={styles.dayAfter}>Balance after: {formatWholeRupees(section.after)}</Text>
        </View>
      )}
      renderItem={({ item, index, section }) => (
        <View style={[styles.cardRow, index === 0 && styles.cardFirst, index === section.data.length - 1 && styles.cardLast]}>
          <View style={index < section.data.length - 1 ? styles.cardDivider : undefined}>
            <TransactionItem row={item} showTime />
          </View>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.meta}>No entries yet.</Text>}
      ListFooterComponent={footer}
    />
  );
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (key: string) => `${Number(key.slice(8, 10))} ${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]}`;
const fmtNav = (e4: number) => `₹${(e4 / 10_000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/** NW-3 (decision 0015): value and gain, 12 months of value against money put in, the numbers, the SIP and the history. */
function FundView({ balance: item, fund, page, footer }: { balance: AccountBalance; fund: NonNullable<Fund>; page: FundPage; footer: React.ReactElement }) {
  const { account } = item;
  const { holding, value } = fund;
  useEffect(() => {
    fetchNavHistory().catch(() => {});
  }, []);
  const invested = value.value - value.gain;
  const unitsE4 = holding.unitsE4 + value.estimatedUnitsE4;
  const pct = invested > 0 ? Math.round((value.gain * 1000) / invested) / 10 : null;
  const avgCost = unitsE4 > 0 ? Math.round((invested * 10_000) / unitsE4) : null;
  const chart = page.chart;
  const nextSip = holding.sipDay ? daysUntil(holding.sipDay) : null;
  const first = chart[0];
  const last = chart[chart.length - 1];
  return (
    <FlatList
      data={page.history}
      keyExtractor={(row, i) => `${row.date}-${i}`}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: '' }} />
          <View style={styles.fundTitle}>
            <Text style={styles.fundName}>{account.name}</Text>
            <Text style={styles.meta} numberOfLines={2}>
              {holding.scheme !== account.name ? holding.scheme : (holding.amc ?? '')}
              {holding.folio ? ` · folio ••${holding.folio.replace(/\s/g, '').slice(-4)}` : ''}
            </Text>
          </View>
          <MoneyCard style={styles.fundCard}>
            <View style={styles.fundValue}>
              <Text style={styles.heroAmount}>{formatWholeRupees(value.value)}</Text>
              <Text style={[styles.fundGain, value.gain < 0 && { color: colors.heroDanger }]}>
                {value.gain >= 0 ? '+' : '−'}
                {formatWholeRupees(Math.abs(value.gain))}
                {pct !== null ? ` · ${Math.abs(pct).toFixed(1)}%` : ''}
              </Text>
            </View>
            {chart.length >= 2 && first && last ? (
              <>
                <LineChart
                  height={84}
                  label={`Value over ${chart.length} months, from ${formatWholeRupees(first.value)} to ${formatWholeRupees(last.value)}, against ${formatWholeRupees(last.invested)} put in`}
                  series={[
                    { values: chart.map((p) => p.invested), color: colors.heroMuted, thickness: 1.5 },
                    { values: chart.map((p) => p.value), color: colors.heroAccent, thickness: 2.5 },
                  ]}
                />
                <View style={styles.legend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendLine, { backgroundColor: colors.heroAccent }]} />
                    <Text style={styles.heroMuted}>Value</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendLine, styles.legendThin, { backgroundColor: colors.heroMuted }]} />
                    <Text style={styles.heroMuted}>What you put in</Text>
                  </View>
                  <Text style={[styles.heroMuted, styles.legendEnd]}>
                    {SHORT_MONTHS[Number(first.month.slice(5)) - 1]} to now
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.heroMuted}>The chart fills in as month-end prices arrive.</Text>
            )}
            {!page.hasStatementHistory && <Text style={styles.heroMuted}>Import your CAS again to see the months before it.</Text>}
          </MoneyCard>
          <View style={styles.tiles}>
            <Tile label="Units" value={(unitsE4 / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 3 })} />
            <Tile label="NAV today" value={value.navE4 !== null ? fmtNav(value.navE4) : '–'} />
            <Tile label="Invested" value={formatWholeRupees(invested)} />
            <Tile label="Average cost" value={avgCost !== null ? `${formatAmount(avgCost)} a unit` : '–'} />
          </View>
          {holding.sipPaise && holding.sipDay && holding.unitsE4 > 0 ? (
            <View style={styles.sip}>
              <Feather name="repeat" size={18} color={colors.primary} />
              <View style={styles.grow}>
                <Text style={styles.sipTitle}>
                  SIP {formatWholeRupees(holding.sipPaise)} on the {ordinal(holding.sipDay)}
                </Text>
                {nextSip !== null && <Text style={styles.meta}>{nextSip === 0 ? 'Next one today' : nextSip === 1 ? 'Next one tomorrow' : `Next in ${nextSip} days`}</Text>}
              </View>
            </View>
          ) : null}
          {page.history.length > 0 && <Text style={styles.section}>HISTORY</Text>}
        </View>
      }
      renderItem={({ item: row, index }) => (
        <View style={[styles.historyRow, index > 0 && styles.historyDivided]}>
          <View style={styles.grow}>
            <Text style={styles.historyTitle}>
              {row.label} · {shortDate(row.date)}
            </Text>
            <Text style={styles.meta}>
              {row.estimated
                ? 'Units estimated until your next CAS'
                : `${(Math.abs(row.unitsE4!) / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 3 })} units${row.navE4 ? ` at ${fmtNav(row.navE4)}` : ''}`}
            </Text>
          </View>
          {row.amount !== null && <Text style={styles.historyAmount}>{formatWholeRupees(row.amount)}</Text>}
        </View>
      )}
      ListFooterComponent={
        <>
          <Text style={[styles.meta, styles.fundNote]}>
            Units from your CAS of {formatDate(`${holding.asOf}T12:00:00`)}
            {value.navDate ? ` · NAV of ${formatDate(`${value.navDate}T12:00:00`)}` : ''}. Import a newer CAS to update them.
          </Text>
          {footer}
        </>
      }
    />
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** Days until the next `day` of the month, today counting as 0. */
function daysUntil(day: number): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const clamp = (y: number, m: number) => Math.min(day, new Date(y, m + 1, 0).getDate());
  let next = new Date(today.getFullYear(), today.getMonth(), clamp(today.getFullYear(), today.getMonth()));
  if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, clamp(today.getFullYear(), today.getMonth() + 1));
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/** NW-2, NW-6: what went in, interest so far and maturity; or a prompt to add the terms. */
function DepositCard({ accountId, deposit, balance, value }: { accountId: string; deposit: LocalDeposit | null; balance: Paise; value: Paise }) {
  if (deposit && isBalanceScheme(deposit.kind)) {
    const info = SCHEMES[deposit.kind as SchemeKind];
    const rate = `${(deposit.rateBp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
    return (
      <Pressable accessibilityRole="button" onPress={() => router.push(`/deposit?account=${accountId}`)} style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}>
        <Line label="Balance" amount={balance} />
        <Line label={`Interest not yet in the balance, at ${rate}`} amount={paise(value - balance)} />
        <Text style={styles.note}>
          {info.label}: interest on each month's balance after the 5th, added every 31 March. An estimate until your passbook shows it
          {deposit.kind === 'epf' ? '' : `; matures on ${formatDate(`${deposit.maturityDate}T12:00:00`)}`}. Tap to change the terms.
        </Text>
      </Pressable>
    );
  }
  if (!deposit) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardText}>Add the interest rate and dates, and the app works out interest, maturity and reminders.</Text>
        <Button title="Add the terms" onPress={() => router.push(`/deposit?account=${accountId}`)} />
      </View>
    );
  }
  const { interest, maturity } = depositValue(deposit);
  const rate = `${(deposit.rateBp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const matures = formatDate(`${deposit.maturityDate}T12:00:00`);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/deposit?account=${accountId}`)} style={({ pressed }) => [styles.card, pressed && styles.pressedCard]}>
      {deposit.closedAt ? (
        <Text style={styles.cardText}>Matured on {matures}. The payout is in your account and the interest is recorded as income.</Text>
      ) : (
        <>
          <Line label="Paid in" amount={balance} />
          <Line label={`Interest so far at ${rate}`} amount={interest} />
          <Line label={`At maturity, ${matures}`} amount={maturity} />
          <Text style={styles.note}>Interest is an estimate until the bank pays it. Tap to change the terms.</Text>
        </>
      )}
    </Pressable>
  );
}

/** NW-3: units, today's NAV and the gain on a fund imported from a CAS. */
function FundCard({ fund, balance }: { fund: NonNullable<Fund>; balance: Paise }) {
  const { holding, value } = fund;
  const fmtUnits = (e4: number) => (e4 / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 4 });
  const units = fmtUnits(holding.unitsE4);
  const nav = value.navE4 !== null ? `₹${(value.navE4 / 10_000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : null;
  const since = balance - holding.costPaise;
  return (
    <View style={styles.card}>
      <Line label="Invested" amount={paise(holding.costPaise)} />
      <Line label={value.gain >= 0 ? 'Gain' : 'Loss'} amount={paise(Math.abs(value.gain))} />
      {since !== 0 && <Line label={since > 0 ? 'Paid in since the statement' : 'Taken out since the statement'} amount={paise(Math.abs(since))} />}
      <Text style={styles.note}>
        {units} units on {formatDate(`${holding.asOf}T12:00:00`)}
        {nav && value.navDate ? ` · NAV ${nav} on ${formatDate(`${value.navDate}T12:00:00`)}` : ''}
        {holding.sipPaise ? ` · SIP ${formatRupees(paise(holding.sipPaise))} around the ${ordinal(holding.sipDay ?? 1)}` : ''}
      </Text>
      {value.estimatedUnitsE4 > 0 && (
        <Text style={styles.note}>About {fmtUnits(value.estimatedUnitsE4)} more units bought since, estimated from the NAV around each payment.</Text>
      )}
      <Text style={styles.note}>{holding.folio ? `Folio ${holding.folio}. ` : ''}Import a newer CAS to update the units.</Text>
    </View>
  );
}

const KIND_LABEL: Record<string, string> = { share: 'Share', etf: 'ETF', gold_bond: 'Gold bond', bond: 'Bond', fund: 'Mutual fund', nps: 'NPS' };
const fmtUnits = (e4: number) => (e4 / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 4 });
const fmtPrice = (e4: number) => `₹${(e4 / 10_000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/** NW-5, NW-6: each share, ETF, bond or NPS scheme at its latest price, with what was paid where known. */
function HoldingsCard({ market }: { market: MarketAccountValue }) {
  const asOf = market.holdings[0]?.holding.asOf;
  return (
    <View style={styles.card}>
      {market.gain !== null && (
        <>
          <Line label="Invested" amount={market.invested} />
          <Line label={market.gain >= 0 ? 'Gain' : 'Loss'} amount={paise(Math.abs(market.gain))} />
        </>
      )}
      {market.missingCost > 0 && (
        <Text style={styles.note}>
          {market.missingCost === market.holdings.length ? 'Add what you paid for each holding to see your gain.' : `Gain leaves out ${market.missingCost} ${market.missingCost === 1 ? 'holding' : 'holdings'} with no price paid yet.`}
        </Text>
      )}
      {market.holdings.map(({ holding, priceE4, priceDate, value }) => (
        <Pressable
          key={holding.id}
          accessibilityRole="button"
          onPress={() => router.push(`/holding-cost?id=${holding.id}`)}
          style={({ pressed }) => [styles.holding, pressed && styles.pressedCard]}
        >
          <View style={styles.grow}>
            <Text style={styles.holdingName} numberOfLines={2}>
              {holding.symbol ?? holding.scheme}
            </Text>
            <Text style={styles.note}>
              {KIND_LABEL[holding.kind]} · {fmtUnits(holding.unitsE4)} units
              {priceE4 !== null ? ` at ${fmtPrice(priceE4)}` : ''}
              {priceDate ? ` on ${formatDate(`${priceDate}T12:00:00`)}` : ''}
            </Text>
            <Text style={[styles.note, holding.costKnown === 0 && styles.link]}>
              {holding.costKnown === 1 ? `Paid ${formatRupees(paise(holding.costPaise))}` : 'Add what you paid'}
            </Text>
          </View>
          <Text style={styles.lineAmount}>{formatRupees(value)}</Text>
        </Pressable>
      ))}
      <Text style={styles.note}>
        Units as on {asOf ? formatDate(`${asOf}T12:00:00`) : 'the statement'}. Import a newer NSDL or CDSL statement to update them.
      </Text>
    </View>
  );
}

function ordinal(day: number): string {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

function Line({ label, amount }: { label: string; amount: Paise }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineAmount}>{formatRupees(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 8 },
  pressedCard: { opacity: 0.85 },
  cardText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  lineLabel: { fontSize: 14, color: colors.muted, flex: 1 },
  lineAmount: { fontSize: 14, fontWeight: '600', color: colors.text, ...figures },
  note: { fontSize: 12, color: colors.muted },
  link: { color: colors.primary, fontWeight: '600' },
  holding: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider },
  holdingName: { fontSize: 14, fontWeight: '500', color: colors.text },
  grow: { flex: 1, minWidth: 0 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  header: { gap: 14, marginBottom: 4 },
  meta: { fontSize: 13, color: colors.muted },
  heroMuted: { fontSize: 13, color: colors.heroMuted, lineHeight: 18 },
  heroAmount: { fontSize: 34, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroStats: { flexDirection: 'row', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.heroLine },
  heroStat: { fontSize: 15, fontWeight: '600', color: colors.heroText, marginTop: 2, ...figures },
  reconciled: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reconciledText: { flex: 1, fontSize: 12, color: colors.heroAccent },
  actions: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.text },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.3, marginTop: 4 },
  paidFrom: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.subtle },
  chipText: { fontSize: 12, color: colors.text, ...figures },
  day: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingTop: 16, paddingBottom: 6 },
  dayText: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },
  dayAfter: { fontSize: 13, color: colors.muted, ...figures },
  cardRow: { paddingHorizontal: 14, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  cardFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 2 },
  cardLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: 2 },
  cardDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  fundTitle: { gap: 2, paddingHorizontal: 4 },
  fundName: { fontSize: 20, fontWeight: '700', color: colors.text },
  fundCard: { gap: 10 },
  fundValue: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  fundGain: { fontSize: 14, fontWeight: '600', color: colors.heroAccent, ...figures },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 14, height: 3, borderRadius: 2 },
  legendThin: { height: 2 },
  legendEnd: { flex: 1, textAlign: 'right' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48.8%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tileValue: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 2, ...figures },
  sip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sipTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  historyDivided: { borderTopWidth: 1, borderTopColor: colors.divider },
  historyTitle: { fontSize: 14, fontWeight: '500', color: colors.text },
  historyAmount: { fontSize: 14, fontWeight: '600', color: colors.text, ...figures },
  fundNote: { marginTop: 16, textAlign: 'center' },
  footer: { marginTop: 24 },
});
