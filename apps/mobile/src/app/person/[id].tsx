import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { FormScroll } from '@/components/keyboard';
import { formatAmount } from '@/components/format';
import { IouRow } from '@/components/people-rows';
import { Sheet } from '@/components/sheet';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, useColors, makeStyles } from '@/components/ui';
import { contactById, pickContact } from '@/lib/contacts';
import { setDoubtful, useDoubtfulPeople } from '@/lib/doubtful';
import { inviteFriend, inviteMessage, linkForEmail, type FriendLink } from '@/lib/friends';
import { getMe, splitVpas } from '@/lib/me';
import { markInvited } from '@/lib/setup';
import { listIous, type IouView } from '@/lib/ious';
import { mergePeople } from '@/lib/merge-people';
import { createPerson, extraVpasOf, getPerson, listPeople, personInUse, removalBlocker, removePerson, SamePersonError, updatePerson, type Person } from '@/lib/people';
import { today } from '@/lib/recurring';
import { useLedger } from '@/lib/use-ledger';

/** A person: their UPI ID and email (IOU-2, IOU-3), the phone contact they are (SPL-4), and every IOU with them. */
export default function PersonDetail() {
  const colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';
  const load = useCallback(async () => {
    if (isNew) return { person: null, ious: [] as IouView[], inUse: true, blocker: null as string | null, others: [] as Person[] };
    const [person, all, inUse, blocker, people] = await Promise.all([getPerson(id), listIous(), personInUse(id), removalBlocker(id), listPeople()]);
    return { person, ious: all.filter((v) => v.personId === id), inUse, blocker, others: people.filter((p) => p.account.id !== id) };
  }, [id, isNew]);
  const { data } = useLedger(load, { person: null as Person | null, ious: [] as IouView[], inUse: true, blocker: null as string | null, others: [] as Person[] });
  const [merging, setMerging] = useState(false);
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [extras, setExtras] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // ACC-9: whether this person is linked on Money Plant. Undefined while loading or offline.
  const [link, setLink] = useState<FriendLink | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  const doubtful = useDoubtfulPeople();
  const [savingDoubt, setSavingDoubt] = useState(false);
  const savedEmail = data.person?.account.email ?? null;

  useEffect(() => {
    if (!savedEmail) return setLink(undefined);
    linkForEmail(savedEmail).then(setLink, () => setLink(undefined));
  }, [savedEmail]);

  function confirmRemove() {
    if (!data.person) return;
    const message = data.inUse
      ? 'They leave People and the pickers. Past entries with them stay, under their name.'
      : 'Use this for someone added by mistake.';
    Alert.alert(`Remove ${data.person.account.name}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          removePerson(id).then(
            () => router.back(),
            (e) => setError(e instanceof Error ? e.message : String(e)),
          ),
      },
    ]);
  }

  // Decision 0020: this person and `other` are one person. The one linked on Money Plant (with an email) is kept.
  function confirmMerge(other: { id: string; name: string }) {
    if (!data.person) return;
    const here = data.person.account;
    const target = data.others.find((p) => p.account.id === other.id)?.account;
    const keepOther = !here.email || Boolean(target?.email);
    const [removeId, keepId] = keepOther ? [id, other.id] : [other.id, id];
    const [removeName, keepName] = keepOther ? [here.name, other.name] : [other.name, here.name];
    Alert.alert(
      `Merge ${removeName} into ${keepName}?`,
      `Everything with ${removeName} (entries, IOUs, groups, UPI ID) moves to ${keepName}, and ${removeName} is removed. Open IOUs are shared with ${keepName} if they're on Money Plant.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          onPress: () =>
            mergePeople(removeId, keepId).then(
              () => (keepId === id ? setMerging(false) : router.replace(`/person/${keepId}`)),
              (e) => setError(e instanceof Error ? e.message : String(e)),
            ),
        },
      ],
    );
  }

  async function invite() {
    if (!savedEmail) return;
    setInviting(true);
    setError(null);
    try {
      const result = await inviteFriend(savedEmail);
      void markInvited();
      if (result === 'invited') await Share.share({ message: inviteMessage(savedEmail, await getMe()) });
      setLink(await linkForEmail(savedEmail));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  }

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'Add a person' : (data.person?.account.name ?? 'Person') });
    if (loaded || !data.person) return;
    const { account, contactId } = data.person;
    setName(account.name);
    setVpa(account.vpa ?? '');
    setExtras(extraVpasOf(account).join(', '));
    setEmail(account.email ?? '');
    if (contactId) contactById(contactId).then((c) => setContact(c ?? { id: contactId, name: 'A contact' }));
    setLoaded(true);
  }, [data.person, isNew, loaded, navigation]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = { name, vpa, email, extraVpas: splitVpas(extras), contactId: contact?.id ?? null };
      if (isNew) {
        const created = await createPerson(input);
        router.replace(`/person/${created}`);
      } else {
        await updatePerson(id, input);
        router.back();
      }
    } catch (e) {
      setSaving(false);
      if (e instanceof SamePersonError && !isNew) {
        Alert.alert('Same person?', e.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: `Merge with ${e.other.name}`, onPress: () => confirmMerge(e.other) },
        ]);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // NW-1: leave out of net worth what someone may never pay back. Saved on the server, so it needs the network.
  async function countInNetWorth(count: boolean) {
    setSavingDoubt(true);
    setError(null);
    try {
      await setDoubtful(id, !count);
    } catch (e) {
      setError(e instanceof Error ? `Couldn't save: ${e.message}` : String(e));
    } finally {
      setSavingDoubt(false);
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
    <FormScroll contentContainerStyle={styles.container}>
      {person && (
        <View style={styles.hero}>
          <Initial name={person.account.name} size={56} />
          {person.balances.length === 0 ? (
            <Text style={styles.heroAmount}>{formatAmount(0)}</Text>
          ) : (
            // Each currency on its own line, never added together (decision 0017).
            person.balances.map((b) => (
              <Text key={b.currency} style={[styles.heroAmount, b.amount > 0 && { color: colors.primary }]}>
                {formatAmount(Math.abs(b.amount), b.currency)}
              </Text>
            ))
          )}
          <Text style={styles.meta}>
            {person.balances.length === 0
              ? 'Settled up'
              : person.balances.every((b) => b.amount > 0)
                ? `${person.account.name} owes you`
                : person.balances.every((b) => b.amount < 0)
                  ? `You owe ${person.account.name}`
                  : person.balances.map((b) => `${b.amount > 0 ? 'they owe you' : 'you owe'} ${formatAmount(Math.abs(b.amount), b.currency)}`).join(', ')}
          </Text>
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
          {(person.balance > 0 || doubtful.has(id)) && (
            <View style={styles.switchRow}>
              <View style={styles.grow}>
                <Text style={styles.switchLabel}>Count what they owe in net worth</Text>
                <Text style={styles.hint}>Turn off for a loan you doubt will come back. What you owe them always counts.</Text>
              </View>
              <Switch value={!doubtful.has(id)} onValueChange={countInNetWorth} disabled={savingDoubt} />
            </View>
          )}
          <Button title="Add an expense with them" onPress={() => router.push(`/expense?person=${id}`)} />
          <Button title="Record a loan" variant="secondary" onPress={() => router.push(`/iou/new?person=${id}`)} />
        </>
      )}

      {person && <SectionTitle>Details</SectionTitle>}
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="Ravi" />
      <Field label="UPI ID" value={vpa} onChangeText={setVpa} autoCapitalize="none" placeholder="ravi@okicici" />
      <Text style={styles.hint}>Used to pay them back from a UPI app, and to spot their payments in your bank SMS.</Text>
      <Field label="Other UPI IDs" value={extras} onChangeText={setExtras} autoCapitalize="none" placeholder="ravi.k@oksbi, 98xxxxxx10@ybl" />
      <Text style={styles.hint}>Only for recognising their payments. Separate them with commas. Added on their own when you tag a payment from a new UPI ID.</Text>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="ravi@gmail.com" />
      <Text style={styles.hint}>If they use Money Plant with this email, they see your IOUs with them and can confirm them.</Text>
      {savedEmail && link !== undefined && (
        link?.state === 'friends' ? (
          <Text style={styles.linked}>Linked on Money Plant</Text>
        ) : link ? (
          <Text style={styles.hint}>{link.state === 'waiting_for_you' ? 'They asked to link with you. Answer in Settings → Invite friends.' : 'Friend request sent.'}</Text>
        ) : (
          <Button title="Invite to Money Plant" variant="secondary" onPress={invite} loading={inviting} />
        )
      )}
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

      {person && (
        <View style={styles.actions}>
          {data.others.length > 0 && <Button title="Same person as someone else?" variant="secondary" onPress={() => setMerging(true)} />}
          {data.blocker === null ? (
            <>
              <Button title="Remove person" variant="secondary" onPress={confirmRemove} />
              <Text style={styles.hint}>
                {data.inUse
                  ? "They're settled up. Removing them keeps past entries under their name."
                  : 'They have no entries, IOUs or groups, so removing them changes nothing else.'}
              </Text>
            </>
          ) : (
            <Text style={styles.hint}>{data.blocker}</Text>
          )}
        </View>
      )}

      <Sheet visible={merging} onClose={() => setMerging(false)} title={`Who else is ${person?.account.name ?? 'this'}?`} tall>
        <Text style={styles.hint}>Pick the other entry for the same person. Their entries and IOUs come together into one.</Text>
        <ScrollView>
          {data.others.map((p) => (
            <Pressable
              key={p.account.id}
              accessibilityRole="button"
              onPress={() => {
                setMerging(false);
                confirmMerge({ id: p.account.id, name: p.account.name });
              }}
              style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
            >
              <Initial name={p.account.name} />
              <View style={styles.grow}>
                <Text style={styles.pickName}>{p.account.name}</Text>
                <Text style={styles.meta}>{[p.account.email, p.account.vpa].filter(Boolean).join(' · ') || 'No email or UPI ID'}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 12 },
  heroAmount: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'], marginTop: 8 },
  meta: { fontSize: 13, color: colors.muted },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  linked: { fontSize: 13, fontWeight: '600', color: colors.primary, marginTop: 6 },
  actions: { marginTop: 16, gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 },
  switchLabel: { fontSize: 15, color: colors.text },
  grow: { flex: 1 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pickName: { fontSize: 15, color: colors.text },
  pressed: { opacity: 0.6 },
}));
