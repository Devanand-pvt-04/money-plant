import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { FormScroll } from '@/components/keyboard';
import { formatAmount, formatSummary } from '@/components/format';
import { ItemRow } from '@/components/people-rows';
import { Sheet } from '@/components/sheet';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, useColors, makeStyles } from '@/components/ui';
import { mobileDigits } from '@money-plant/matcher';
import { contactById, pickContact } from '@/lib/contacts';
import { setDoubtful, useDoubtfulPeople } from '@/lib/doubtful';
import { inviteFriend, inviteMessage, linkForEmail, type FriendLink } from '@/lib/friends';
import { getMe, splitVpas } from '@/lib/me';
import { markInvited } from '@/lib/setup';
import { itemsWith, payLink, personTotals, reminderMessage, type ItemView } from '@/lib/shared';
import { openUpiLink } from '@/lib/upi';
import { mergePeople } from '@/lib/merge-people';
import { removeIdentifier } from '@/lib/identity';
import { createPerson, extraVpasOf, formatBankAccount, getPerson, phoneOf, listPeople, personInUse, removalBlocker, removePerson, SamePersonError, updatePerson, type Person } from '@/lib/people';
import { useLedger } from '@/lib/use-ledger';

/** A person: what you owe each other and every shared item with them (decision 0026), and everything that identifies them (decision 0025). */
export default function PersonDetail() {
  const colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';
  const load = useCallback(async () => {
    if (isNew) return { person: null, items: [] as ItemView[], gap: new Map<string, number>(), inUse: true, blocker: null as string | null, others: [] as Person[] };
    const [person, items, totals, inUse, blocker, people] = await Promise.all([getPerson(id), itemsWith(id), personTotals(id), personInUse(id), removalBlocker(id), listPeople()]);
    return { person, items, gap: totals.gap as Map<string, number>, inUse, blocker, others: people.filter((p) => p.account.id !== id) };
  }, [id, isNew]);
  const { data } = useLedger(load, {
    person: null as Person | null,
    items: [] as ItemView[],
    gap: new Map<string, number>(),
    inUse: true,
    blocker: null as string | null,
    others: [] as Person[],
  });
  const [merging, setMerging] = useState(false);
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [extras, setExtras] = useState('');
  const [phone, setPhone] = useState('');
  const [bankAccounts, setBankAccounts] = useState('');
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
  const names = data.person?.identifiers.filter((i) => i.kind === 'payee_name') ?? [];

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
      `Everything with ${removeName} (entries, shared items, UPI IDs) moves to ${keepName}, and ${removeName} is removed. Your items are shared with ${keepName} if they're on Money Plant.`,
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
    setExtras(extraVpasOf(data.person).join(', '));
    setPhone(phoneOf(data.person) ?? '');
    setBankAccounts(data.person.identifiers.filter((i) => i.kind === 'bank_account').map(formatBankAccount).join(', '));
    setEmail(account.email ?? '');
    if (contactId) contactById(contactId).then((c) => setContact(c ?? { id: contactId, name: 'A contact' }));
    setLoaded(true);
  }, [data.person, isNew, loaded, navigation]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = { name, vpa, email, extraVpas: splitVpas(extras), phone, bankAccounts, contactId: contact?.id ?? null };
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
      // Decision 0021: the contact's mobile number recognises their number-based UPI IDs.
      const mobile = picked.phones.map(mobileDigits).find((m): m is string => m !== null);
      if (mobile && !phone.trim()) setPhone(mobile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const person = data.person;
  const open = data.items.filter((v) => v.status !== 'linked' && v.status !== 'declined');
  const closed = data.items.filter((v) => !open.includes(v));
  const pay = person ? payLink(person) : null;

  async function remind() {
    if (!person) return;
    try {
      await Share.share({ message: reminderMessage(person, await getMe()) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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
                {formatSummary(Math.abs(b.amount), b.currency)}
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
          {[...data.gap].map(([currency, amount]) => (
            <Text key={currency} style={styles.hint}>
              {formatAmount(Math.abs(amount), currency)} of what you and {person.account.name} share isn't in your ledger yet. Link your entries below.
            </Text>
          ))}
          {person.balances.length > 0 && <Button title="Settle up" onPress={() => router.push(`/settle?person=${id}`)} />}
          <View style={styles.buttons}>
            {person.balances.length > 0 && <Button title="Remind" variant="secondary" onPress={remind} />}
            {pay && <Button title="Pay with UPI" variant="secondary" onPress={() => void openUpiLink(pay).catch((e) => setError(String(e?.message ?? e)))} />}
          </View>
          {open.length > 0 && (
            <>
              <SectionTitle>Waiting for you</SectionTitle>
              <Card>
                {open.map((v, i) => (
                  <ItemRow key={v.id} view={v} first={i === 0} />
                ))}
              </Card>
            </>
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
          <Button title="Split a bill with them" variant={person.balances.length > 0 ? 'secondary' : 'primary'} onPress={() => router.push(`/split?person=${id}`)} />
          <Button title="Record a loan or repayment" variant="secondary" onPress={() => router.push(`/item/new?person=${id}&kind=loan`)} />
        </>
      )}

      {person && <SectionTitle>Details</SectionTitle>}
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="Ravi" />
      <Field label="UPI ID" value={vpa} onChangeText={setVpa} autoCapitalize="none" placeholder="ravi@okicici" />
      <Text style={styles.hint}>Used to pay them back from a UPI app, and to spot their payments in your bank SMS.</Text>
      <Field label="Other UPI IDs" value={extras} onChangeText={setExtras} autoCapitalize="none" placeholder="ravi.k@oksbi, 98xxxxxx10@ybl" />
      <Text style={styles.hint}>Only for recognising their payments. Separate them with commas. Added on their own when you tag a payment from a new UPI ID.</Text>
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" />
      <Text style={styles.hint}>Recognises their payments from UPI IDs made from this number, like 98765…@ybl, in any app.</Text>
      <Field label="Bank accounts" value={bankAccounts} onChangeText={setBankAccounts} autoCapitalize="characters" placeholder="HDFC 1234, SBI 5678" />
      <Text style={styles.hint}>The bank and the last 4 digits are enough. Recognises their IMPS and NEFT transfers and statement rows.</Text>
      {names.length > 0 && (
        <>
          <Text style={styles.label}>Names their bank shows</Text>
          <Chips>
            {names.map((n) => (
              <Chip key={n.id} label={`${n.value.toUpperCase()}  ×`} selected={false} onPress={() => void removeIdentifier(n.id)} />
            ))}
          </Chips>
          <Text style={styles.hint}>Learned when you tag their payments. Tap one to forget it.</Text>
        </>
      )}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="ravi@gmail.com" />
      <Text style={styles.hint}>If they use Money Plant with this email, they see what you share with them and can accept it.</Text>
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
          <Text style={styles.hint}>Fills in their name and phone number. Which contact they are stays on this phone.</Text>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={isNew ? 'Add' : 'Save'} onPress={save} loading={saving} />
      </View>

      {closed.length > 0 && (
        <>
          <SectionTitle>History</SectionTitle>
          <Card>
            {closed.map((v, i) => (
              <ItemRow key={v.id} view={v} first={i === 0} />
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
                  : 'They have no entries or shared items, so removing them changes nothing else.'}
              </Text>
            </>
          ) : (
            <Text style={styles.hint}>{data.blocker}</Text>
          )}
        </View>
      )}

      <Sheet visible={merging} onClose={() => setMerging(false)} title={`Who else is ${person?.account.name ?? 'this'}?`} tall>
        <Text style={styles.hint}>Pick the other entry for the same person. Their entries and shared items come together into one.</Text>
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
  buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 },
  switchLabel: { fontSize: 15, color: colors.text },
  grow: { flex: 1 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pickName: { fontSize: 15, color: colors.text },
  pressed: { opacity: 0.6 },
}));
