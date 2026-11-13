import { useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatAmount, formatSummary } from '@/components/format';
import { ItemRow, NetByCurrency } from '@/components/people-rows';
import { Sheet } from '@/components/sheet';
import { ErrorText, Card, Initial, SectionTitle, radius, useColors, makeStyles } from '@/components/ui';
import { mergePeople } from '@/lib/merge-people';
import { dismissDuplicate, duplicateSuggestions, listPeople, type DuplicateSuggestion, type Person } from '@/lib/people';
import { listItems, type ItemView } from '@/lib/shared';
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

/** Decision 0026: who owes whom, what waits for the user, and one way to add a share, loan or repayment. */
export default function People() {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation();
  const [adding, setAdding] = useState(false);
  const { data, reload } = useLedger(
    load,
    { people: [] as Person[], items: [] as ItemView[], waiting: [] as ItemView[], duplicates: [] as DuplicateSuggestion[] },
    'people',
  );
  const { refreshing, onRefresh, error } = usePullToRefresh(reload);
  const [mergeError, setMergeError] = useState<string | null>(null);

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
        <Pressable accessibilityRole="button" accessibilityLabel="Add a person, share or loan" hitSlop={8} onPress={() => setAdding(true)} style={styles.headerButton}>
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

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {error && <ErrorText>{error}</ErrorText>}
        <View style={styles.totals}>
          <View style={styles.total}>
            <Text style={styles.meta}>You'll get back</Text>
            <Text style={[styles.totalAmount, owedToMe > 0 && { color: colors.primary }]}>{formatSummary(owedToMe)}</Text>
            <Text style={styles.meta}>{owing.length === 0 ? 'from no one' : `from ${owing.length} ${owing.length === 1 ? 'person' : 'people'}`}</Text>
          </View>
          <View style={styles.total}>
            <Text style={styles.meta}>You owe</Text>
            <Text style={[styles.totalAmount, iOwe > 0 && { color: colors.danger }]}>{formatSummary(iOwe)}</Text>
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

        {data.waiting.length > 0 && (
          <>
            <SectionTitle>Waiting for you</SectionTitle>
            <Card>
              {data.waiting.map((v, i) => (
                <ItemRow key={v.id} view={v} first={i === 0} />
              ))}
            </Card>
          </>
        )}

        <SectionTitle>People</SectionTitle>
        {people.length === 0 ? (
          <Text style={styles.meta}>No one yet. Split a payment with someone, or record a loan, and they show up here.</Text>
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
                    {personNote(p, data.items)}
                  </Text>
                </View>
                <NetByCurrency balances={p.balances} />
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" onPress={() => router.push('/item/new')} style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
        <Feather name="plus" size={20} color={colors.onInk} />
        <Text style={styles.fabText}>Split or lend</Text>
      </Pressable>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add">
        {(
          [
            { icon: 'user-plus', title: 'Add a person', href: '/person/new' },
            { icon: 'users', title: 'Split a bill', href: '/split' },
            { icon: 'corner-up-right', title: 'Record a loan', href: '/item/new?kind=loan' },
            { icon: 'corner-down-left', title: 'Record a repayment', href: '/item/new?kind=repayment' },
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
