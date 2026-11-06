import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Chip, Chips, colors, radius } from '@/components/ui';
import { pickContact } from '@/lib/contacts';
import { createPerson, type Person } from '@/lib/people';

/**
 * People as chips, with a way to add someone by name or from the phone's
 * contacts (SPL-4) without leaving the screen.
 */
export function PersonPicker(props: {
  people: readonly Person[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** Called with the new person's id after it is created; the caller reloads people. */
  onCreated: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function add(input: { name: string; contactId?: string | null }) {
    try {
      const id = await createPerson(input);
      setAdding(false);
      setName('');
      props.onCreated(id);
    } catch (e) {
      Alert.alert("Couldn't add", e instanceof Error ? e.message : String(e));
    }
  }

  async function fromContacts() {
    try {
      const contact = await pickContact();
      if (!contact) return;
      const existing = props.people.find((p) => p.contactId === contact.id || p.account.name.toLowerCase() === contact.name.toLowerCase());
      if (existing) {
        if (!props.selected.includes(existing.account.id)) props.onToggle(existing.account.id);
        setAdding(false);
        return;
      }
      await add({ name: contact.name, contactId: contact.id });
    } catch (e) {
      Alert.alert("Couldn't open contacts", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View>
      <Chips>
        {props.people.map((p) => (
          <Chip key={p.account.id} label={p.account.name} selected={props.selected.includes(p.account.id)} onPress={() => props.onToggle(p.account.id)} />
        ))}
        <Chip label="+ Someone new" selected={adding} onPress={() => setAdding(!adding)} />
      </Chips>
      {adding && (
        <View style={styles.add}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Their name"
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={80}
            autoFocus
            onSubmitEditing={() => name.trim() && add({ name })}
          />
          <Pressable accessibilityRole="button" style={styles.action} disabled={!name.trim()} onPress={() => add({ name })}>
            <Text style={[styles.actionText, !name.trim() && styles.disabled]}>Add</Text>
          </Pressable>
          {Platform.OS === 'android' && (
            <Pressable accessibilityRole="button" style={styles.action} onPress={fromContacts}>
              <Text style={styles.actionText}>Contacts</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  actionText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  disabled: { opacity: 0.4 },
});
