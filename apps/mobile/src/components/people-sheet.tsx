import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { mobileDigits } from '@money-plant/matcher';
import { formatAmount } from '@/components/format';
import { Sheet } from '@/components/sheet';
import { Button, Initial, radius, useColors, makeStyles } from '@/components/ui';
import { pickContact } from '@/lib/contacts';
import { createPerson, phoneOf, type Person } from '@/lib/people';

/**
 * Who's in a split (decision 0027): a sheet with search, the people the user
 * shares with most recently first, then everyone, and a way to add someone
 * new by name or from the phone's contacts (SPL-4).
 */
export function PeopleSheet(props: {
  visible: boolean;
  onClose: () => void;
  people: readonly Person[];
  /** Person id to the day of the latest item with them, for "Recent". */
  recent: ReadonlyMap<string, string>;
  selected: readonly string[];
  onToggle: (id: string) => void;
  /** Called with the new person's id after it is created; the caller reloads people and selects them. */
  onCreated: (id: string) => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();

  const { recent, everyone } = useMemo(() => {
    const matches = (p: Person) =>
      !q ||
      p.account.name.toLowerCase().includes(q) ||
      (p.account.vpa ?? '').toLowerCase().includes(q) ||
      (phoneOf(p) ?? '').includes(q.replace(/\s/g, ''));
    const found = props.people.filter(matches);
    const recentOnes = found
      .filter((p) => props.recent.has(p.account.id))
      .sort((a, b) => props.recent.get(b.account.id)!.localeCompare(props.recent.get(a.account.id)!))
      .slice(0, 5);
    const shown = new Set(recentOnes.map((p) => p.account.id));
    return { recent: recentOnes, everyone: found.filter((p) => !shown.has(p.account.id)) };
  }, [props.people, props.recent, q]);

  const exact = props.people.some((p) => p.account.name.trim().toLowerCase() === q);

  async function add(input: { name: string; contactId?: string | null; phone?: string | null }) {
    setBusy(true);
    try {
      const id = await createPerson(input);
      setQuery('');
      props.onCreated(id);
    } catch (e) {
      Alert.alert("Couldn't add", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fromContacts() {
    try {
      const contact = await pickContact();
      if (!contact) return;
      const phone = contact.phones.map(mobileDigits).find((m): m is string => m !== null) ?? null;
      const existing = props.people.find(
        (p) => p.contactId === contact.id || p.account.name.toLowerCase() === contact.name.toLowerCase() || (phone !== null && phoneOf(p) === phone),
      );
      if (existing) {
        if (!props.selected.includes(existing.account.id)) props.onToggle(existing.account.id);
        return;
      }
      await add({ name: contact.name, contactId: contact.id, phone });
    } catch (e) {
      Alert.alert("Couldn't open contacts", e instanceof Error ? e.message : String(e));
    }
  }

  const row = (p: Person, i: number) => {
    const on = props.selected.includes(p.account.id);
    const owed = p.balances[0];
    const sub = owed
      ? owed.amount > 0
        ? `Owes you ${formatAmount(owed.amount, owed.currency)}`
        : `You owe ${formatAmount(-owed.amount, owed.currency)}`
      : (p.account.vpa ?? phoneOf(p) ?? (p.account.email ? 'On Money Plant' : null));
    return (
      <Pressable
        key={p.account.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        onPress={() => props.onToggle(p.account.id)}
        style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
      >
        <Initial name={p.account.name} size={36} />
        <View style={styles.grow}>
          <Text style={styles.name} numberOfLines={1}>
            {p.account.name}
          </Text>
          {sub && (
            <Text style={styles.meta} numberOfLines={1}>
              {sub}
            </Text>
          )}
        </View>
        <View style={[styles.tick, on && styles.tickOn]}>{on && <Feather name="check" size={14} color={colors.onInk} />}</View>
      </Pressable>
    );
  };

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title="Who's in" tall>
      <View style={styles.search}>
        <Feather name="search" size={16} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, UPI ID or phone"
          placeholderTextColor={colors.placeholder}
          style={styles.searchInput}
          autoCorrect={false}
          maxLength={80}
        />
        {query.length > 0 && (
          <Pressable accessibilityLabel="Clear" hitSlop={8} onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {q.length > 0 && !exact && (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => add({ name: query.trim() })} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <View style={styles.actionIcon}>
              <Feather name="user-plus" size={16} color={colors.primary} />
            </View>
            <Text style={styles.actionText}>Add “{query.trim()}”</Text>
          </Pressable>
        )}
        {Platform.OS === 'android' && (
          <Pressable accessibilityRole="button" onPress={fromContacts} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <View style={styles.actionIcon}>
              <Feather name="book" size={16} color={colors.primary} />
            </View>
            <Text style={styles.actionText}>Pick from contacts</Text>
          </Pressable>
        )}
        {recent.length > 0 && (
          <>
            <Text style={styles.section}>Recent</Text>
            <View style={styles.card}>{recent.map(row)}</View>
          </>
        )}
        {everyone.length > 0 && (
          <>
            <Text style={styles.section}>{recent.length > 0 ? 'Everyone else' : 'People'}</Text>
            <View style={styles.card}>{everyone.map(row)}</View>
          </>
        )}
        {recent.length === 0 && everyone.length === 0 && (
          <Text style={styles.empty}>{q ? 'No one by that name yet.' : 'No people yet. Add someone by name or from your contacts.'}</Text>
        )}
      </ScrollView>
      <Button title={props.selected.length > 0 ? `Done · ${props.selected.length} picked` : 'Done'} onPress={props.onClose} />
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.subtle,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8 },
  list: { paddingBottom: 8 },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 16, marginBottom: 6, marginHorizontal: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 4, borderRadius: radius.md },
  actionIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  empty: { fontSize: 14, color: colors.muted, marginTop: 16, marginHorizontal: 4, lineHeight: 20 },
}));
