import { useCallback, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { formatMonth, formatWholeRupees } from '@/components/format';
import { Card, ErrorText, ProgressBar, colors, radius } from '@/components/ui';
import { categoriseWithAi } from '@/lib/ai-categorise';
import { ensureDefaultCategories } from '@/lib/categories';
import { currentMonth, monthOverview, type BudgetLine } from '@/lib/budgets';
import { hasImportedInbox, importInbox } from '@/lib/capture';
import { countPending, listAccountBalances, netWorth, type AccountBalance } from '@/lib/ledger';
import { syncNow } from '@/lib/sync';
import { useLedger } from '@/lib/use-ledger';
import { hasSmsPermission, isSmsReaderAvailable } from '../../../modules/sms-reader';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function loadHome() {
  await ensureDefaultCategories();
  const [balances, pending, imported, overview] = await Promise.all([
    listAccountBalances(),
    countPending(),
    hasImportedInbox(),
    monthOverview(currentMonth()),
  ]);
  return { balances, pending, imported, month: overview.overall, elapsed: overview.elapsed };
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
    elapsed: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      // Catch up on SMS that arrived while the receiver couldn't run, then sync.
      if (isSmsReaderAvailable && hasSmsPermission() && (await hasImportedInbox())) await importInbox();
      await syncNow();
      setError(null);
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
        <View>
          <Text style={styles.date}>
            {DAYS[now.getDay()]}, {now.getDate()} {MONTHS[now.getMonth()]}
          </Text>
          <Text style={styles.hello}>{greeting(now)}</Text>
        </View>

        {!smsReady && (
          <Pressable accessibilityRole="button" style={styles.callout} onPress={() => router.push('/capture')}>
            <Text style={styles.calloutTitle}>Read your bank SMS</Text>
            <Text style={styles.calloutText}>
              Money Plant can fill your ledger from ICICI, HDFC, HSBC and SBI messages. The text stays on this phone.
            </Text>
          </Pressable>
        )}

        {data.month && <MonthCard line={data.month} elapsed={data.elapsed} />}

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
              <Text style={styles.meta}>About {Math.max(10, Math.ceil((data.pending * 8) / 10) * 10)} seconds</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}

        <View style={styles.tiles}>
          <Tile label="Net worth" value={formatWholeRupees(netWorth(data.balances))} />
          <Tile
            label="Accounts"
            value={String(data.balances.length)}
            note={flagged > 0 ? `${flagged} off from the bank` : undefined}
          />
        </View>

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

/** BUD-2: this month's spending at a glance, with a tick where an even pace would be. */
function MonthCard({ line, elapsed }: { line: BudgetLine; elapsed: number }) {
  const status = line.pace?.status ?? 'ok';
  const month = currentMonth();
  const today = new Date();
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
  const pill = status === 'over' ? 'Over budget' : status === 'pace' ? 'Spending fast' : 'On track';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/budgets')}
      style={({ pressed }) => [styles.month, pressed && styles.pressed]}
    >
      <View style={styles.between}>
        <Text style={styles.monthLabel}>Spent in {formatMonth(month).split(' ')[0]}</Text>
        {line.limit !== null && (
          <Text style={[styles.pill, status === 'ok' ? styles.pillOk : styles.pillWarn]}>{pill}</Text>
        )}
      </View>
      <Text style={styles.monthAmount}>
        {formatWholeRupees(line.spent)}
        {line.limit !== null ? <Text style={styles.monthOf}>  of {formatWholeRupees(line.limit)}</Text> : null}
      </Text>
      {line.limit !== null ? (
        <>
          <ProgressBar value={line.spent / line.limit} status={status} marker={elapsed} />
          <Text style={styles.monthNote}>
            {status === 'over'
              ? `Over by ${formatWholeRupees(line.spent - line.limit)}.`
              : status === 'pace'
                ? `On pace for ${formatWholeRupees(line.pace!.projected)} by month end.`
                : `${formatWholeRupees(line.limit - line.spent)} left for ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`}{' '}
            The tick marks an even pace.
          </Text>
        </>
      ) : (
        <Text style={styles.monthNote}>Tap to set a monthly budget.</Text>
      )}
    </Pressable>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/money')} style={styles.tile}>
      <Card style={styles.tileCard}>
        <Text style={styles.meta}>{label}</Text>
        <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {note && <Text style={styles.tileWarn}>{note}</Text>}
      </Card>
    </Pressable>
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
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthLabel: { fontSize: 13, fontWeight: '500', color: colors.muted },
  pill: { fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  pillOk: { color: colors.primary, backgroundColor: colors.primarySurface },
  pillWarn: { color: colors.warning, backgroundColor: colors.warningSurface },
  monthAmount: { fontSize: 34, fontWeight: '700', color: colors.text, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  monthOf: { fontSize: 14, fontWeight: '400', color: colors.muted, letterSpacing: 0 },
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
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  tileCard: { padding: 16, gap: 6 },
  tileValue: { fontSize: 19, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  tileWarn: { fontSize: 12, fontWeight: '500', color: colors.warning },
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
