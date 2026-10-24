import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatAmount, formatWholeRupees } from '@/components/format';
import { Balance } from '@/components/people-rows';
import { Button, Card, Initial, SectionTitle, colors } from '@/components/ui';
import { listIous, type IouView } from '@/lib/ious';
import { listPeople, type Person } from '@/lib/people';
import { listGroups, type SplitGroup } from '@/lib/splits';
import { useLedger } from '@/lib/use-ledger';

async function load() {
  const [people, ious, groups] = await Promise.all([listPeople(), listIous(), listGroups()]);
  return { people, toConfirm: ious.filter((v) => v.state === 'awaiting_me'), groups };
}

/** IOU-1 to IOU-5, SPL-3: who owes whom, IOUs shared with the user, and groups. */
export default function People() {
  const { data } = useLedger(load, { people: [] as Person[], toConfirm: [] as IouView[], groups: [] as SplitGroup[] });
  const owedToMe = data.people.reduce((s, p) => s + Math.max(0, p.balance), 0);
  const iOwe = data.people.reduce((s, p) => s + Math.max(0, -p.balance), 0);
  const balances = new Map(data.people.map((p) => [p.account.id, p.balance]));
  // People with money open first, then the rest by name.
  const people = [...data.people].sort((a, b) => Number(b.balance !== 0) - Number(a.balance !== 0) || a.account.name.localeCompare(b.account.name));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.totals}>
        <View style={styles.total}>
          <Text style={styles.meta}>Owed to you</Text>
          <Text style={[styles.totalAmount, owedToMe > 0 && { color: colors.primary }]}>{formatWholeRupees(owedToMe)}</Text>
        </View>
        <View style={styles.total}>
          <Text style={styles.meta}>You owe</Text>
          <Text style={styles.totalAmount}>{formatWholeRupees(iOwe)}</Text>
        </View>
      </View>

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
                <Text style={styles.amount}>{formatAmount(v.amount)}</Text>
              </Pressable>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>People</SectionTitle>
      {people.length === 0 ? (
        <Text style={styles.meta}>No one yet. Record a loan or split a bill, and the people in it show up here.</Text>
      ) : (
        <Card>
          {people.map((p, i) => (
            <PersonRow key={p.account.id} person={p} first={i === 0} />
          ))}
        </Card>
      )}
      <View style={styles.buttons}>
        <Button title="Record a loan" onPress={() => router.push('/iou/new')} />
        <Button title="Someone else paid for me" variant="secondary" onPress={() => router.push('/split/paid')} />
        <Button title="Add a person" variant="secondary" onPress={() => router.push('/person/new')} />
      </View>

      <SectionTitle>Groups</SectionTitle>
      {data.groups.length > 0 && (
        <Card>
          {data.groups.map((g, i) => {
            const net = g.memberIds.reduce((s, id) => s + (balances.get(id) ?? 0), 0);
            return (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                onPress={() => router.push(`/group/${g.id}`)}
                style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
              >
                <View style={styles.grow}>
                  <Text style={styles.name}>{g.name}</Text>
                  <Text style={styles.meta}>
                    {g.memberIds.length} {g.memberIds.length === 1 ? 'person' : 'people'}
                  </Text>
                </View>
                <Balance amount={net} />
              </Pressable>
            );
          })}
        </Card>
      )}
      <Text style={styles.meta}>A trip or flatmates: pick the group when you split a bill, and see where everyone stands.</Text>
      <Button title="New group" variant="secondary" onPress={() => router.push('/group/new')} />
    </ScrollView>
  );
}

function PersonRow({ person, first }: { person: Person; first: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/person/${person.account.id}`)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <Initial name={person.account.name} />
      <View style={styles.grow}>
        <Text style={styles.name}>{person.account.name}</Text>
        <Text style={styles.meta}>{person.balance > 0 ? 'Owes you' : person.balance < 0 ? 'You owe' : 'Settled up'}</Text>
      </View>
      <Balance amount={person.balance} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  totals: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  total: { flex: 1, padding: 16, borderRadius: 18, backgroundColor: colors.subtle, gap: 4 },
  totalAmount: { fontSize: 22, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  buttons: { gap: 10, marginTop: 8 },
});
