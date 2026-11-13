import { useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatAmount } from '@/components/format';
import { Net, NetByCurrency, dueText } from '@/components/people-rows';
import { Sheet } from '@/components/sheet';
import { ErrorText, Card, Initial, SectionTitle, radius, useColors, makeStyles } from '@/components/ui';
import { isOpen, listIous, type IouView } from '@/lib/ious';
import { mergePeople } from '@/lib/merge-people';
import { dismissDuplicate, duplicateSuggestions, listPeople, type DuplicateSuggestion, type Person } from '@/lib/people';
import { today } from '@/lib/recurring';
import { groupOverview, listGroups, type GroupOverview } from '@/lib/splits';
import { usePullToRefresh } from '@/lib/refresh';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const [people, ious, groups] = await Promise.all([listPeople(), listIous(), listGroups()]);
  const context = { groups, people, ious };
  const overviews = (await Promise.all(groups.map((g) => groupOverview(g.id, context)))).filter((g): g is GroupOverview => g !== null);
  const duplicates = await duplicateSuggestions(people);
  return { people, ious, toConfirm: ious.filter((v) => v.state === 'awaiting_me'), groups: overviews, duplicates };
}

/** What a person's open IOUs are about, in a few words: "Owes you for Goa stay", "Lunch split, 2 entries". */
function personNote(person: Person, ious: readonly IouView[], day: string): string {
  if (person.balances.length === 0) return 'Settled up';
  const open = ious.filter((v) => v.personId === person.account.id && isOpen(v)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const reason = open[0]?.reason?.replace(/^(Split|Share of): ?/, '') ?? null;
  if (open.length > 1) return reason ? `${reason} and ${open.length - 1} more` : `${open.length} open entries`;
  const due = open[0] ? dueText(open[0], day) : null;
  const lead = (person.balance || person.balances[0]!.amount) > 0 ? (reason ? `Owes you for ${reason}` : 'Owes you') : reason ? `You owe for ${reason}` : 'You owe';
  return due ? `${lead} · ${due}` : lead;
}

const REASONS: Record<DuplicateSuggestion['reason'], string> = { email: 'same email', vpa: 'same UPI ID', phone: 'same phone number', name: 'same name' };

/** IOU-1 to IOU-5, SPL-1, SPL-3: who owes whom, groups, and one way to add an expense with people. */
export default function People() {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation();
  const [adding, setAdding] = useState(false);
  const { data, reload } = useLedger(
    load,
    { people: [] as Person[], ious: [] as IouView[], toConfirm: [] as IouView[], groups: [] as GroupOverview[], duplicates: [] as DuplicateSuggestion[] },
    'people',
  );
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Decision 0020: the same person twice, usually a phone contact and the friend who joined later.
  function confirmMerge(d: DuplicateSuggestion) {
    Alert.alert(
      `Merge ${d.removeName} into ${d.keepName}?`,
      `Everything with ${d.removeName} (entries, IOUs, groups, UPI ID) moves to ${d.keepName}, and ${d.removeName} is removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', onPress: () => mergePeople(d.remove, d.keep).catch((e) => setMergeError(e instanceof Error ? e.message : String(e))) },
      ],
    );
  }


  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a person, group or loan" hitSlop={8} onPress={() => setAdding(true)} style={styles.headerButton}>
          <Feather name="plus" size={24} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, colors, styles]);

  // Totals in the home currency at today's rate (decision 0017); each person's row keeps their own currencies.
  const owing = data.people.filter((p) => p.balance > 0);
  const owed = data.people.filter((p) => p.balance < 0);
  const owedToMe = owing.reduce((s, p) => s + p.balance, 0);
  const iOwe = owed.reduce((s, p) => s - p.balance, 0);
  // People with money open first, largest first, then the rest by name.
  const people = [...data.people].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.account.name.localeCompare(b.account.name));
  const day = today();

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {error && <ErrorText>{error}</ErrorText>}
        <View style={styles.totals}>
          <View style={styles.total}>
            <Text style={styles.meta}>You'll get back</Text>
            <Text style={[styles.totalAmount, owedToMe > 0 && { color: colors.primary }]}>{formatAmount(owedToMe)}</Text>
            <Text style={styles.meta}>{owing.length === 0 ? 'from no one' : `from ${owing.length} ${owing.length === 1 ? 'person' : 'people'}`}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.meta}>You owe</Text>
            <Text style={[styles.totalAmount, iOwe > 0 && { color: colors.danger }]}>{formatAmount(iOwe)}</Text>
            <Text style={styles.meta}>{owed.length === 0 ? 'to no one' : `to ${owed.length} ${owed.length === 1 ? 'person' : 'people'}`}</Text>
          </View>
        </View>

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

        {data.toConfirm.length > 0 && (
          <>
            <SectionTitle>Shared with you</SectionTitle>
            <Card>
              {data.toConfirm.map((v, i) => (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/iou/${v.id}`)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <Initial name={v.otherName} />
                  <View style={styles.grow}>
                    <Text style={styles.name}>{v.direction === 'borrowed' ? `You owe ${v.otherName}` : `${v.otherName} owes you`}</Text>
                    <Text style={styles.meta}>{v.reason ?? 'No reason given'} · tap to confirm</Text>
                  </View>
                  <Text style={styles.amount}>{formatAmount(v.amount, v.currency)}</Text>
                </Pressable>
              ))}
            </Card>
          </>
        )}

        {data.groups.length > 0 && (
          <>
            <SectionTitle>Groups</SectionTitle>
            <Card>
              {data.groups.map((g, i) => (
                <Pressable
                  key={g.group.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/group/${g.group.id}`)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <View style={styles.groupIcon}>
                    <Text style={styles.groupLetter}>{g.group.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.name}>{g.group.name}</Text>
                    <Text style={styles.meta}>
                      {g.group.memberIds.length + 1} people · {g.expenses.length === 0 ? 'no expenses yet' : g.net === 0 && g.members.every((m) => m.balance === 0) ? 'settled up' : `${formatAmount(g.spent, g.currency)} spent`}
                    </Text>
                  </View>
                  <Net amount={g.net} currency={g.currency} />
                </Pressable>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>People</SectionTitle>
        {people.length === 0 ? (
          <Text style={styles.meta}>No one yet. Add an expense with someone, or record a loan, and they show up here.</Text>
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
                    {personNote(p, data.ious, day)}
                  </Text>
                </View>
                <NetByCurrency balances={p.balances} />
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" onPress={() => router.push('/expense')} style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
        <Feather name="plus" size={20} color={colors.onInk} />
        <Text style={styles.fabText}>Add expense</Text>
      </Pressable>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add">
        {(
          [
            { icon: 'user-plus', title: 'Add a person', href: '/person/new' },
            { icon: 'users', title: 'New group', href: '/group/edit' },
            { icon: 'corner-up-right', title: 'Record a loan', href: '/iou/new' },
          ] as const
        ).map((item) => (
          <Pressable
            key={item.href}
            accessibilityRole="button"
            onPress={() => {
              setAdding(false);
              router.push(item.href);
            }}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Feather name={item.icon} size={20} color={colors.text} />
            <Text style={styles.name}>{item.title}</Text>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 96, gap: 8 },
  duplicateActions: { flexDirection: 'row', gap: 20, marginTop: 6 },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary },
  linkMuted: { fontSize: 14, color: colors.muted },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  totals: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  total: { flex: 1, padding: 16, borderRadius: 18, backgroundColor: colors.subtle, gap: 4 },
  totalAmount: { fontSize: 24, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  groupIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  groupLetter: { fontSize: 16, fontWeight: '700', color: colors.primary },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    elevation: 4,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { fontSize: 16, fontWeight: '700', color: colors.onInk },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 8, borderRadius: radius.md },
}));
