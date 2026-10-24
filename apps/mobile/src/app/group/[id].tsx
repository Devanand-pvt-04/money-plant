import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatWholeRupees } from '@/components/format';
import { Net } from '@/components/people-rows';
import { Card, Initial, SectionTitle, colors, radius } from '@/components/ui';
import { groupOverview, type GroupExpense, type GroupOverview } from '@/lib/splits';
import { useLedger } from '@/lib/use-ledger';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * SPL-3: a group's own expenses, and where each member stands within the
 * group. Settling up opens each person, whose total is netted across
 * everything, so one payment settles them everywhere.
 */
export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { data } = useLedger(() => groupOverview(id), null as GroupOverview | null);

  useEffect(() => {
    if (!data) return;
    navigation.setOptions({
      title: data.group.name,
      headerRight: () => (
        <View style={styles.headerActions}>
          {data.members.some((m) => m.balance !== 0) && (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/person/${data.members.find((m) => m.balance !== 0)!.person.account.id}`)}>
              <Text style={styles.link}>Settle up</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="Edit group" hitSlop={8} onPress={() => router.push(`/group/edit?id=${id}`)}>
            <Feather name="edit-2" size={18} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [data, id, navigation]);

  if (!data) return null;
  const people = data.group.memberIds.length + 1;
  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.heroHead}>
            <Text style={[styles.meta, styles.grow]}>{data.net > 0 ? "You're owed overall" : data.net < 0 ? 'You owe overall' : 'All square'}</Text>
            <Text style={styles.meta}>
              {formatWholeRupees(data.spent)} spent by {people}
            </Text>
          </View>
          <Text style={[styles.big, data.net > 0 && { color: colors.primary }, data.net < 0 && { color: colors.danger }]}>{formatWholeRupees(Math.abs(data.net))}</Text>
          {data.members.map(({ person, balance }) => (
            <Pressable key={person.account.id} accessibilityRole="button" onPress={() => router.push(`/person/${person.account.id}`)} style={styles.member}>
              <Initial name={person.account.name} size={30} />
              <Text style={[styles.memberText, styles.grow]} numberOfLines={1}>
                {balance > 0 ? `${person.account.name.split(' ')[0]} owes you` : balance < 0 ? `You owe ${person.account.name.split(' ')[0]}` : `${person.account.name.split(' ')[0]} is settled`}
              </Text>
              <Text style={[styles.memberText, balance > 0 && { color: colors.primary }, balance < 0 && { color: colors.danger }]}>{formatWholeRupees(Math.abs(balance))}</Text>
            </Pressable>
          ))}
        </View>

        <SectionTitle>Expenses</SectionTitle>
        {data.expenses.length === 0 ? (
          <Text style={styles.meta}>Nothing yet. Add the first expense, and everyone's share lands here.</Text>
        ) : (
          <Card>
            {data.expenses.map((e, i) => (
              <ExpenseRow key={e.id} expense={e} first={i === 0} />
            ))}
          </Card>
        )}
        <Text style={styles.meta}>Balances here count only this group. A person's page shows everything with them.</Text>
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/expense?group=${id}`)} style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
        <Feather name="plus" size={20} color={colors.onInk} />
        <Text style={styles.fabText}>Add expense</Text>
      </Pressable>
    </>
  );
}

function ExpenseRow({ expense, first }: { expense: GroupExpense; first: boolean }) {
  const d = new Date(expense.occurredAt);
  const how = expense.payerName === null ? `You paid ${formatWholeRupees(expense.total)}${expense.ways > 1 ? ` · split ${expense.ways} ways` : ''}` : `${expense.payerName} paid ${formatWholeRupees(expense.total)}`;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/transaction/${expense.id}`)} style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}>
      <View style={styles.date}>
        <Text style={styles.dateMonth}>{MONTHS[d.getMonth()]}</Text>
        <Text style={styles.dateDay}>{d.getDate()}</Text>
      </View>
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={2}>
          {expense.title}
        </Text>
        <Text style={styles.meta}>{how}</Text>
      </View>
      <Net amount={expense.net} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 96, gap: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginRight: 8 },
  link: { fontSize: 15, fontWeight: '600', color: colors.primary },
  hero: { padding: 16, borderRadius: 20, backgroundColor: colors.subtle, gap: 8 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  big: { fontSize: 30, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  memberText: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  date: { width: 32, alignItems: 'center' },
  dateMonth: { fontSize: 11, color: colors.muted },
  dateDay: { fontSize: 17, fontWeight: '700', color: colors.text },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
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
});
