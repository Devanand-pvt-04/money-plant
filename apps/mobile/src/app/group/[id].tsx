import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { formatAmount } from '@/components/format';
import { Balance } from '@/components/people-rows';
import { PersonPicker } from '@/components/person-picker';
import { Button, Card, ErrorText, Field, SectionTitle, colors } from '@/components/ui';
import { listPeople, type Person } from '@/lib/people';
import { deleteGroup, listGroups, saveGroup } from '@/lib/splits';

/**
 * SPL-3: a personal group (a trip, flatmates). Its balances are each
 * member's balance with the user, already netted across every split and
 * loan, so settling one IOU per person settles the group.
 */
export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);
  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New group' : 'Group' });
    reloadPeople();
    if (isNew) return;
    listGroups().then((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) return;
      setName(group.name);
      setMembers(group.memberIds);
      navigation.setOptions({ title: group.name });
    });
  }, [id, isNew, navigation, reloadPeople]);

  const toggle = (pid: string) => setMembers((m) => (m.includes(pid) ? m.filter((x) => x !== pid) : [...m, pid]));
  const inGroup = people.filter((p) => members.includes(p.account.id));
  const owedToMe = inGroup.reduce((s, p) => s + Math.max(0, p.balance), 0);
  const iOwe = inGroup.reduce((s, p) => s + Math.max(0, -p.balance), 0);

  async function save() {
    setSaving(true);
    try {
      await saveGroup({ id: isNew ? undefined : id, name, memberIds: members });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {!isNew && inGroup.length > 0 && (
        <>
          <Text style={styles.summary}>
            {owedToMe > 0 ? `They owe you ${formatAmount(owedToMe)}` : 'No one owes you'}
            {iOwe > 0 ? ` · you owe ${formatAmount(iOwe)}` : ''}
          </Text>
          <Card>
            {inGroup.map((p, i) => (
              <Pressable
                key={p.account.id}
                accessibilityRole="button"
                onPress={() => router.push(`/person/${p.account.id}`)}
                style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
              >
                <View style={styles.grow}>
                  <Text style={styles.name}>{p.account.name}</Text>
                  <Text style={styles.meta}>{p.balance > 0 ? 'Owes you' : p.balance < 0 ? 'You owe' : 'Settled up'}</Text>
                </View>
                <Balance amount={p.balance} />
              </Pressable>
            ))}
          </Card>
          <Text style={styles.meta}>Balances include everything with each person, not only this group.</Text>
          <SectionTitle>Edit group</SectionTitle>
        </>
      )}
      <Field label="Name" value={name} onChangeText={setName} placeholder="Goa trip, Flat 4B" maxLength={60} />
      <Text style={styles.label}>People</Text>
      <PersonPicker people={people} selected={members} onToggle={toggle} onCreated={(pid) => reloadPeople().then(() => toggle(pid))} />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={isNew ? 'Create group' : 'Save'} onPress={save} loading={saving} />
        {!isNew && (
          <Pressable
            accessibilityRole="button"
            style={styles.remove}
            onPress={() =>
              Alert.alert('Delete this group?', 'Splits and IOUs with its people stay.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteGroup(id).then(() => router.back()) },
              ])
            }
          >
            <Text style={styles.removeText}>Delete group</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  summary: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  actions: { marginTop: 24, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
