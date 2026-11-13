import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useNavigation, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatAmount, formatSummary } from '@/components/format';
import { ErrorText, Card, Initial, MoneyCard, SectionTitle, figures, radius, useColors, makeStyles } from '@/components/ui';
import { mergePeople } from '@/lib/merge-people';
import { dismissDuplicate, duplicateSuggestions, listPeople, type DuplicateSuggestion, type Person } from '@/lib/people';
import { itemTitle, listItems, statusText, type ItemView } from '@/lib/shared';
import { usePullToRefresh } from '@/lib/refresh';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const [people, items] = await Promise.all([listPeople(), listItems()]);
  const duplicates = await duplicateSuggestions(people);
  // A friend's share to answer first, then the user's own side to link.
  const waiting = items
    .filter((v) => v.status === 'needs_answer' || v.status === 'needs_link')
    .sort((a, b) => Number(b.status === 'needs_answer') - Number(a.status === 'needs_answer'));
  return { people, items, waiting, duplicates };
}

/** What is going on with a person, in a few words: "Dinner and 2 more", "Waiting for you". */
function personNote(person: Person, items: readonly ItemView[]): string {
  const theirs = items.filter((v) => v.personId === person.account.id && v.status !== 'declined');
  const waiting = theirs.filter((v) => v.status === 'needs_answer' || v.status === 'needs_link').length;
  if (waiting > 0) return `${waiting} waiting for you`;
  if (person.balances.length === 0) return theirs.length > 0 ? 'Settled up' : 'Nothing yet';
  const latest = theirs[0];
  const what = latest?.reason ?? null;
  const lead = (person.balance || person.balances[0]!.amount) > 0 ? 'Owes you' : 'You owe';
  if (!what) return lead;
  return theirs.length > 1 ? `${lead} · ${what} and ${theirs.length - 1} more` : `${lead} · ${what}`;
}

const REASONS: Record<DuplicateSuggestion['reason'], string> = { email: 'same email', vpa: 'same UPI ID', phone: 'same phone number', account: 'same bank account', name: 'same name' };

type Filter = 'all' | 'owed' | 'owe' | 'settled';

/**
 * Decisions 0026 and 0028: where the user stands with everyone on a money
 * card, round shortcuts to start a split, loan or repayment, what waits for
 * the user, then people filtered by who owes whom.
 */
export default function People() {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation();
  const { data, reload } = useLedger(
    load,
    { people: [] as Person[], items: [] as ItemView[], waiting: [] as ItemView[], duplicates: [] as DuplicateSuggestion[] },
    'people',
  );
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  // Decision 0020: the same person twice, usually a phone contact and the friend who joined later.
  function confirmMerge(d: DuplicateSuggestion) {
    Alert.alert(
      `Merge ${d.removeName} into ${d.keepName}?`,
      `Everything with ${d.removeName} (entries, shared items, UPI IDs) moves to ${d.keepName}, and ${d.removeName} is removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', onPress: () => mergePeople(d.remove, d.keep).catch((e) => setMergeError(e instanceof Error ? e.message : String(e))) },
      ],
    );
  }

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Friends on Money Plant" hitSlop={8} onPress={() => router.push('/friends')} style={styles.headerButton}>
          <Feather name="user-plus" size={18} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, colors, styles]);

  // Totals in the home currency at today's rate (decision 0017); each person's row keeps their own currencies.
  const owing = data.people.filter((p) => p.balance > 0);
  const owed = data.people.filter((p) => p.balance < 0);
  const owedToMe = owing.reduce((s, p) => s + p.balance, 0);
  const iOwe = owed.reduce((s, p) => s - p.balance, 0);
  const net = owedToMe - iOwe;
  // People with money open first, largest first, then the rest by name.
  const sorted = [...data.people].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.account.name.localeCompare(b.account.name));
  const open = sorted.filter((p) => p.balances.length > 0);
  const settled = sorted.filter((p) => p.balances.length === 0);
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: open.length },
    { key: 'owed', label: 'Owe you', count: owing.length },
    { key: 'owe', label: 'You owe', count: owed.length },
    { key: 'settled', label: 'Settled', count: settled.length },
  ];
  const active = filter !== 'all' && filters.find((f) => f.key === filter)!.count === 0 ? 'all' : filter;
  const people = active === 'owed' ? owing : active === 'owe' ? owed : active === 'settled' ? settled : open;

  const shortcuts: { icon: ComponentProps<typeof Feather>['name']; label: string; href: Href }[] = [
    { icon: 'users', label: 'Split a bill', href: '/split' },
    { icon: 'arrow-up-right', label: 'Lend', href: '/item/new?kind=loan' },
    { icon: 'corner-down-left', label: 'Repayment', href: '/item/new?kind=repayment' },
    { icon: 'user-plus', label: 'Add person', href: '/person/new' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {error && <ErrorText>{error}</ErrorText>}
      <MoneyCard>
        <View>
          <Text style={styles.heroLabel}>{net < 0 ? 'Overall, you owe' : "Overall, you'll get back"}</Text>
          <Text style={[styles.heroValue, net > 0 && { color: colors.heroAccent }, net < 0 && { color: colors.heroWarning }]}>{formatSummary(Math.abs(net))}</Text>
        </View>
        <View style={styles.heroSplit}>
          <View style={styles.heroPart}>
            <Text style={styles.heroSmall}>Owed to you</Text>
            <Text style={styles.heroPartValue}>
              {formatSummary(owedToMe)}
              {owing.length > 0 ? ` · ${owing.length}` : ''}
            </Text>
          </View>
          <View style={styles.heroPart}>
            <Text style={styles.heroSmall}>You owe</Text>
            <Text style={[styles.heroPartValue, iOwe > 0 && { color: colors.heroWarning }]}>
              {formatSummary(iOwe)}
              {owed.length > 0 ? ` · ${owed.length}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.heroLine} />
        <View style={styles.shortcuts}>
          {shortcuts.map((s) => (
            <Pressable
              key={s.label}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              onPress={() => router.push(s.href)}
              style={({ pressed }) => [styles.shortcut, pressed && styles.pressedFade]}
            >
              <View style={styles.shortcutIcon}>
                <Feather name={s.icon} size={18} color={colors.heroAccent} />
              </View>
              <Text style={styles.shortcutLabel} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </MoneyCard>

      {data.waiting.map((v) => (
        <Pressable
          key={v.id}
          accessibilityRole="button"
          onPress={() => router.push(`/item/${v.id}`)}
          style={({ pressed }) => [styles.banner, pressed && styles.pressedFade]}
        >
          <Initial name={v.personName} size={36} />
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={1}>
              {v.reason ?? itemTitle(v)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {formatAmount(v.amount, v.currency)} · {statusText(v)}
            </Text>
          </View>
          <Text style={styles.bannerAction}>{v.status === 'needs_answer' ? 'Answer' : 'Link'}</Text>
        </Pressable>
      ))}

      {mergeError && <ErrorText>{mergeError}</ErrorText>}
      {data.duplicates.length > 0 && (
        <>
          <SectionTitle>Same person?</SectionTitle>
          <Card>
            {data.duplicates.map((d, i) => (
              <View key={`${d.keep}|${d.remove}`} style={[styles.row, i > 0 && styles.divided]}>
                <Initial name={d.keepName} />
                <View style={styles.grow}>
                  <Text style={styles.name}>
                    {d.removeName} and {d.keepName}
                  </Text>
                  <Text style={styles.meta}>{REASONS[d.reason]}</Text>
                  <View style={styles.duplicateActions}>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmMerge(d)}>
                      <Text style={styles.link}>Merge</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void dismissDuplicate(d.keep, d.remove)}>
                      <Text style={styles.linkMuted}>Not the same</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {data.people.length === 0 ? (
        <Text style={styles.empty}>No one yet. Split a payment with someone, or record a loan, and they show up here.</Text>
      ) : (
        <>
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
                  <Text style={[styles.pillText, active === f.key && styles.pillTextOn]}>{f.key === 'all' ? f.label : `${f.label} ${f.count}`}</Text>
                </Pressable>
              ))}
          </View>
          {people.length === 0 ? (
            <Text style={styles.empty}>Everyone is settled up.</Text>
          ) : (
            <Card>
              {people.map((p, i) => (
                <Pressable
                  key={p.account.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/person/${p.account.id}`)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <Initial name={p.account.name} />
                  <View style={styles.grow}>
                    <Text style={styles.name}>{p.account.name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {personNote(p, data.items).replace(/^(Owes you|You owe) · /, '')}
                    </Text>
                  </View>
                  <PersonAmount person={p} />
                </Pressable>
              ))}
            </Card>
          )}
          {active === 'all' && settled.length > 0 && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setFilter('settled')} style={styles.more}>
              <Text style={styles.moreText}>
                {settled.length} settled {settled.length === 1 ? 'person' : 'people'} under Settled
              </Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** A person's open amounts, one per currency, each with "owes you" or "you owe" under it (decision 0028). */
function PersonAmount({ person }: { person: Person }) {
  const colors = useColors();
  const styles = useStyles();
  if (person.balances.length === 0) return <Text style={styles.settled}>All square</Text>;
  return (
    <View style={styles.right}>
      {person.balances.map((b) => (
        <Text key={b.currency} style={[styles.amount, { color: b.amount > 0 ? colors.primary : colors.warning }]}>
          {formatSummary(Math.abs(b.amount), b.currency)}
        </Text>
      ))}
      <Text style={styles.small}>{(person.balance || person.balances[0]!.amount) > 0 ? 'owes you' : 'you owe'}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  duplicateActions: { flexDirection: 'row', gap: 20, marginTop: 6 },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary },
  linkMuted: { fontSize: 14, color: colors.muted },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  heroLabel: { fontSize: 13, fontWeight: '500', color: colors.heroMuted },
  heroValue: { fontSize: 34, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroSplit: { flexDirection: 'row', gap: 10 },
  heroPart: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.06)' },
  heroSmall: { fontSize: 11, color: colors.heroMuted },
  heroPartValue: { fontSize: 16, fontWeight: '700', color: colors.heroText, marginTop: 2, ...figures },
  heroLine: { height: 1, backgroundColor: colors.heroLine },
  shortcuts: { flexDirection: 'row' },
  shortcut: { flex: 1, alignItems: 'center', gap: 6 },
  shortcutIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.heroPill, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel: { fontSize: 12, fontWeight: '500', color: colors.heroText },
  pressedFade: { opacity: 0.7 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, backgroundColor: colors.primarySurface },
  bannerAction: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onInk,
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  pill: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.text },
  pillTextOn: { color: colors.onInk },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text, ...figures },
  small: { fontSize: 11, color: colors.muted, marginTop: 1 },
  settled: { fontSize: 13, color: colors.muted },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 8 },
  more: { alignSelf: 'center', paddingVertical: 6 },
  moreText: { fontSize: 13, fontWeight: '600', color: colors.primary },
}));
