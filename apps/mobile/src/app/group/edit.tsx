import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { PersonPicker } from '@/components/person-picker';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { listPeople, type Person } from '@/lib/people';
import { deleteGroup, listGroups, saveGroup } from '@/lib/splits';

/** SPL-3: create or edit a personal group (a trip, flatmates): its name and people. */
export default function GroupEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  const isNew = !id;
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);
  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New group' : 'Edit group' });
    reloadPeople();
    if (isNew) return;
    listGroups().then((groups) => {
      const group = groups.find((g) => g.id === id);
      if (!group) return;
      setName(group.name);
      setMembers(group.memberIds);
    });
  }, [id, isNew, navigation, reloadPeople]);

  const toggle = (pid: string) => setMembers((m) => (m.includes(pid) ? m.filter((x) => x !== pid) : [...m, pid]));

  async function save() {
    setSaving(true);
    try {
      const saved = await saveGroup({ id, name, memberIds: members });
      if (isNew) router.replace(`/group/${saved}`);
      else router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
              Alert.alert('Delete this group?', 'Its expenses, splits and IOUs stay, just without the group.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteGroup(id!).then(() => router.dismissTo('/people')) },
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
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  actions: { marginTop: 24, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
