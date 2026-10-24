import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { formatAmount } from '@/components/format';
import { IouRow } from '@/components/people-rows';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, colors } from '@/components/ui';
import { contactById, pickContact } from '@/lib/contacts';
import { listIous, type IouView } from '@/lib/ious';
import { createPerson, getPerson, updatePerson, type Person } from '@/lib/people';
import { today } from '@/lib/recurring';
import { useLedger } from '@/lib/use-ledger';

/** A person: their UPI ID and email (IOU-2, IOU-3), the phone contact they are (SPL-4), and every IOU with them. */
export default function PersonDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';
  const load = useCallback(async () => {
    if (isNew) return { person: null, ious: [] as IouView[] };
    const [person, all] = await Promise.all([getPerson(id), listIous()]);
    return { person, ious: all.filter((v) => v.personId === id) };
  }, [id, isNew]);
  const { data } = useLedger(load, { person: null as Person | null, ious: [] as IouView[] });
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'Add a person' : (data.person?.account.name ?? 'Person') });
    if (loaded || !data.person) return;
    const { account, contactId } = data.person;
    setName(account.name);
    setVpa(account.vpa ?? '');
    setEmail(account.email ?? '');
    if (contactId) contactById(contactId).then((c) => setContact(c ?? { id: contactId, name: 'A contact' }));
    setLoaded(true);
  }, [data.person, isNew, loaded, navigation]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = { name, vpa, email, contactId: contact?.id ?? null };
      if (isNew) {
        const created = await createPerson(input);
        router.replace(`/person/${created}`);
      } else {
        await updatePerson(id, input);
        router.back();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  async function linkContact() {
    try {
      const picked = await pickContact();
      if (!picked) return;
      setContact(picked);
      if (!name.trim()) setName(picked.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const person = data.person;
  const day = today();
  const open = data.ious.filter((v) => v.outstanding > 0 && v.state !== 'declined');
  const closed = data.ious.filter((v) => !open.includes(v));

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {person && (
        <View style={styles.hero}>
          <Initial name={person.account.name} size={56} />
          <Text style={[styles.heroAmount, person.balance > 0 && { color: colors.primary }]}>{formatAmount(Math.abs(person.balance))}</Text>
          <Text style={styles.meta}>{person.balance > 0 ? `${person.account.name} owes you` : person.balance < 0 ? `You owe ${person.account.name}` : 'Settled up'}</Text>
        </View>
      )}

      {person && (
        <>
          <SectionTitle>Open</SectionTitle>
          {open.length === 0 ? (
            <Text style={styles.meta}>Nothing open with {person.account.name}.</Text>
          ) : (
            <Card>
              {open.map((v, i) => (
                <IouRow key={v.id} view={v} today={day} first={i === 0} />
              ))}
            </Card>
          )}
          <Button title="Add an expense with them" onPress={() => router.push(`/expense?person=${id}`)} />
          <Button title="Record a loan" variant="secondary" onPress={() => router.push(`/iou/new?person=${id}`)} />
        </>
      )}

      {person && <SectionTitle>Details</SectionTitle>}
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="Ravi" />
      <Field label="UPI ID" value={vpa} onChangeText={setVpa} autoCapitalize="none" placeholder="ravi@okicici" />
      <Text style={styles.hint}>Used to pay them back from a UPI app, and to spot their payments in your bank SMS.</Text>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="ravi@gmail.com" />
      <Text style={styles.hint}>If they use Money Plant with this email, they see your IOUs with them and can confirm them.</Text>
      {Platform.OS === 'android' && (
        <>
          <Text style={styles.label}>Phone contact</Text>
          <Chips>
            <Chip label={contact ? contact.name : 'Link a contact'} selected={contact !== null} onPress={linkContact} />
            {contact && <Chip label="Unlink" selected={false} onPress={() => setContact(null)} />}
          </Chips>
          <Text style={styles.hint}>Helps match their UPI payments. Stays on this phone.</Text>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={isNew ? 'Add' : 'Save'} onPress={save} loading={saving} />
      </View>

      {closed.length > 0 && (
        <>
          <SectionTitle>Settled</SectionTitle>
          <Card>
            {closed.map((v, i) => (
              <IouRow key={v.id} view={v} today={day} first={i === 0} />
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 12 },
  heroAmount: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'], marginTop: 8 },
  meta: { fontSize: 13, color: colors.muted },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 16, gap: 10 },
});
