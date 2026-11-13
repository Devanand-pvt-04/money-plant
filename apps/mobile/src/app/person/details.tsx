import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { mobileDigits } from '@money-plant/matcher';
import { FormScroll } from '@/components/keyboard';
import { Sheet } from '@/components/sheet';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, useColors, makeStyles } from '@/components/ui';
import { contactById, pickContact } from '@/lib/contacts';
import { setDoubtful, useDoubtfulPeople } from '@/lib/doubtful';
import { inviteFriend, inviteMessage, linkForEmail, type FriendLink } from '@/lib/friends';
import { removeIdentifier } from '@/lib/identity';
import { getMe, splitVpas } from '@/lib/me';
import { mergePeople } from '@/lib/merge-people';
import { extraVpasOf, formatBankAccount, getPerson, listPeople, personInUse, phoneOf, removalBlocker, removePerson, SamePersonError, updatePerson, type Person, type PersonInput } from '@/lib/people';
import { markInvited } from '@/lib/setup';
import { useLedger } from '@/lib/use-ledger';

type FieldKey = 'name' | 'email' | 'upi' | 'phone' | 'bank';

/** Everything as it is now, so a sheet changes one field and keeps the rest. */
function inputOf(person: Person): PersonInput {
  return {
    name: person.account.name,
    vpa: person.account.vpa,
    email: person.account.email,
    extraVpas: extraVpasOf(person),
    phone: phoneOf(person),
    bankAccounts: bankAccountsOf(person),
  };
}

function bankAccountsOf(person: Person): string {
  return person.identifiers.filter((i) => i.kind === 'bank_account').map(formatBankAccount).join(', ');
}

/**
 * A person's details behind the pencil (decision 0027): one line each, and a
 * tap changes one field in a sheet that saves on its own. Empty fields say
 * "Add", never example text that looks like real data. The net worth switch,
 * merge and remove live here too.
 */
export default function PersonDetails() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const load = useCallback(async () => {
    const [person, inUse, blocker, people] = await Promise.all([getPerson(id), personInUse(id), removalBlocker(id), listPeople()]);
    return { person, inUse, blocker, others: people.filter((p) => p.account.id !== id) };
  }, [id]);
  const { data } = useLedger(load, { person: null as Person | null, inUse: true, blocker: null as string | null, others: [] as Person[] });
  const person = data.person;
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [contactSheet, setContactSheet] = useState(false);
  const [merging, setMerging] = useState(false);
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [link, setLink] = useState<FriendLink | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doubtful = useDoubtfulPeople();
  const [savingDoubt, setSavingDoubt] = useState(false);
  const savedEmail = person?.account.email ?? null;
  const contactId = person?.contactId ?? null;

  useEffect(() => {
    navigation.setOptions({ title: person ? `${person.account.name}'s details` : 'Details' });
  }, [navigation, person]);

  useEffect(() => {
    if (!savedEmail) return setLink(undefined);
    linkForEmail(savedEmail).then(setLink, () => setLink(undefined));
  }, [savedEmail]);

  useEffect(() => {
    if (!contactId) return setContact(null);
    contactById(contactId).then((c) => setContact(c ?? { id: contactId, name: 'A contact' }));
  }, [contactId]);

  /** Saves one change. A clash with someone else offers to merge them (decision 0020). */
  async function save(change: Partial<PersonInput>): Promise<boolean> {
    if (!person) return false;
    try {
      await updatePerson(id, { ...inputOf(person), ...change });
      return true;
    } catch (e) {
      if (e instanceof SamePersonError) {
        Alert.alert('Same person?', e.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: `Merge with ${e.other.name}`, onPress: () => confirmMerge(e.other) },
        ]);
        return false;
      }
      throw e;
    }
  }

  // Decision 0020: this person and `other` are one person. The one linked on Money Plant (with an email) is kept.
  function confirmMerge(other: { id: string; name: string }) {
    if (!person) return;
    const here = person.account;
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
              () => {
                setMerging(false);
                // Kept under the other person: go to them. The page underneath says this one is gone.
                if (keepId !== id) router.replace(`/person/${keepId}`);
              },
              (e) => setError(e instanceof Error ? e.message : String(e)),
            ),
        },
      ],
    );
  }

  function confirmRemove() {
    if (!person) return;
    const message = data.inUse ? 'They leave People and the pickers. Past entries with them stay, under their name.' : 'Use this for someone added by mistake.';
    Alert.alert(`Remove ${person.account.name}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          removePerson(id).then(
            () => router.dismissTo('/people'),
            (e) => setError(e instanceof Error ? e.message : String(e)),
          ),
      },
    ]);
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

  async function pickAnotherContact() {
    setContactSheet(false);
    try {
      const picked = await pickContact();
      if (!picked || !person) return;
      // Decision 0021: the contact's mobile number recognises their number-based UPI IDs.
      const mobile = picked.phones.map(mobileDigits).find((m): m is string => m !== null);
      await save({ contactId: picked.id, ...(mobile && !phoneOf(person) ? { phone: mobile } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function unlinkContact() {
    setContactSheet(false);
    try {
      await save({ contactId: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!person) return <View style={styles.container} />;

  const upis = [person.account.vpa, ...extraVpasOf(person)].filter((v): v is string => Boolean(v));
  const phone = phoneOf(person);
  const banks = bankAccountsOf(person);
  const names = person.identifiers.filter((i) => i.kind === 'payee_name');
  const emailNote =
    link?.state === 'friends'
      ? 'Linked on Money Plant'
      : link?.state === 'waiting_for_you'
        ? 'Asked to link with you. Answer in Settings → Invite friends.'
        : link
          ? 'Friend request sent'
          : undefined;

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.lead}>Tap a line to change it. Each change saves on its own.</Text>
      <Card>
        <Line first label="Name" value={person.account.name} onPress={() => setEditing('name')} />
        <Line label="Email" value={savedEmail} note={emailNote} accent={link?.state === 'friends'} onPress={() => setEditing('email')} />
        {Platform.OS === 'android' && <Line label="Contact" value={contact?.name ?? null} empty="Link" onPress={() => (contact ? setContactSheet(true) : void pickAnotherContact())} />}
      </Card>
      {savedEmail && link === null && <Button title="Invite to Money Plant" variant="secondary" onPress={invite} loading={inviting} />}

      <SectionTitle>How the app spots their payments</SectionTitle>
      <Text style={styles.hint}>Learned when you tag their payments. Add more to catch them sooner.</Text>
      <Card>
        <Line first label="UPI IDs" value={upis.length > 0 ? upis.join(', ') : null} onPress={() => setEditing('upi')} />
        <Line label="Phone" value={phone} onPress={() => setEditing('phone')} />
        <Line label="Bank accounts" value={banks || null} onPress={() => setEditing('bank')} />
        {names.length > 0 && (
          <View style={[styles.namesRow, styles.divided]}>
            <Text style={styles.lineLabel}>Names their bank shows</Text>
            <Chips>
              {names.map((n) => (
                <Chip key={n.id} label={`${n.value.toUpperCase()}  ×`} selected={false} onPress={() => void removeIdentifier(n.id)} />
              ))}
            </Chips>
            <Text style={styles.hint}>Tap one to forget it.</Text>
          </View>
        )}
      </Card>

      {(person.balance > 0 || doubtful.has(id)) && (
        <Card style={styles.switchCard}>
          <View style={styles.grow}>
            <Text style={styles.switchLabel}>Count what they owe in net worth</Text>
            <Text style={styles.hint}>Turn off for money you doubt will come back. What you owe them always counts.</Text>
          </View>
          <Switch value={!doubtful.has(id)} onValueChange={countInNetWorth} disabled={savingDoubt} />
        </Card>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {(data.others.length > 0 || data.blocker === null) && (
        <Card style={styles.menu}>
        {data.others.length > 0 && <MenuLine first icon="git-merge" title="Same person as someone else?" onPress={() => setMerging(true)} />}
        {data.blocker === null && <MenuLine first={data.others.length === 0} danger icon="trash-2" title={`Remove ${person.account.name}`} onPress={confirmRemove} />}
        </Card>
      )}
      <Text style={styles.hint}>
        {data.blocker ??
          (data.inUse ? "They're settled up. Removing them keeps past entries under their name." : 'They have no entries or shared items, so removing them changes nothing else.')}
      </Text>

      <EditSheet field={editing} person={person} onClose={() => setEditing(null)} save={save} />

      <Sheet visible={contactSheet} onClose={() => setContactSheet(false)} title={contact?.name ?? 'Phone contact'}>
        <Text style={styles.hint}>Fills in their name and phone number. Which contact they are stays on this phone.</Text>
        <View style={styles.sheetActions}>
          <Button title="Pick another contact" variant="secondary" onPress={pickAnotherContact} />
          <Button title="Unlink" variant="secondary" onPress={unlinkContact} />
        </View>
      </Sheet>

      <Sheet visible={merging} onClose={() => setMerging(false)} title={`Who else is ${person.account.name}?`} tall>
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
              style={({ pressed }) => [styles.pickRow, pressed && styles.pressedFade]}
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

/** One field in a sheet. Saving closes it; a clash leaves it open behind the merge question. */
function EditSheet(props: { field: FieldKey | null; person: Person; onClose: () => void; save: (change: Partial<PersonInput>) => Promise<boolean> }) {
  const styles = useStyles();
  const { field, person } = props;
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!field) return;
    setError(null);
    setSaving(false);
    setText(
      field === 'name'
        ? person.account.name
        : field === 'email'
          ? (person.account.email ?? '')
          : field === 'upi'
            ? (person.account.vpa ?? '')
            : field === 'phone'
              ? (phoneOf(person) ?? '')
              : bankAccountsOf(person),
    );
    setExtra(extraVpasOf(person).join(', '));
    // Opening the sheet starts from the person as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  async function done() {
    if (!field) return;
    setError(null);
    if (field === 'name' && !text.trim()) return setError('Enter a name');
    setSaving(true);
    try {
      const change: Partial<PersonInput> =
        field === 'name'
          ? { name: text }
          : field === 'email'
            ? { email: text }
            : field === 'upi'
              ? { vpa: text, extraVpas: splitVpas(extra) }
              : field === 'phone'
                ? { phone: text }
                : { bankAccounts: text };
      if (await props.save(change)) props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const title = field === 'name' ? 'Name' : field === 'email' ? 'Email' : field === 'upi' ? 'UPI IDs' : field === 'phone' ? 'Phone' : 'Bank accounts';
  return (
    <Sheet visible={field !== null} onClose={props.onClose} title={title}>
      {field === 'name' && <Field label="Name" value={text} onChangeText={setText} maxLength={80} autoFocus />}
      {field === 'email' && (
        <>
          <Field label="Email" value={text} onChangeText={setText} autoCapitalize="none" keyboardType="email-address" autoFocus />
          <Text style={styles.hint}>If they use Money Plant with this email, they see what you share with them and can accept it.</Text>
        </>
      )}
      {field === 'upi' && (
        <>
          <Field label="Main UPI ID" value={text} onChangeText={setText} autoCapitalize="none" autoFocus />
          <Text style={styles.hint}>Used to pay them back from a UPI app, and to spot their payments in your bank SMS.</Text>
          <Field label="Other UPI IDs" value={extra} onChangeText={setExtra} autoCapitalize="none" />
          <Text style={styles.hint}>Only for recognising their payments. Separate them with commas.</Text>
        </>
      )}
      {field === 'phone' && (
        <>
          <Field label="Phone" value={text} onChangeText={setText} keyboardType="phone-pad" autoFocus />
          <Text style={styles.hint}>Recognises their payments from UPI IDs made from this number, in any app.</Text>
        </>
      )}
      {field === 'bank' && (
        <>
          <Field label="Bank accounts" value={text} onChangeText={setText} autoCapitalize="characters" autoFocus />
          <Text style={styles.hint}>The bank and the last 4 digits are enough, like “HDFC 1234”. Separate them with commas.</Text>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.sheetActions}>
        <Button title="Save" onPress={done} loading={saving} />
      </View>
    </Sheet>
  );
}

function Line(props: { label: string; value: string | null; empty?: string; note?: string; accent?: boolean; first?: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const empty = props.value === null || props.value === '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${empty ? 'not set' : props.value}. Change`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <Text style={styles.lineLabel}>{props.label}</Text>
      <View style={styles.grow}>
        {empty ? (
          <Text style={styles.add}>{props.empty ?? 'Add'}</Text>
        ) : (
          <Text style={styles.value} numberOfLines={2}>
            {props.value}
          </Text>
        )}
        {props.note && <Text style={[styles.note, props.accent && { color: colors.primary }]}>{props.note}</Text>}
      </View>
      <Feather name={empty ? 'plus' : 'chevron-right'} size={16} color={colors.muted} />
    </Pressable>
  );
}

function MenuLine(props: { icon: ComponentProps<typeof Feather>['name']; title: string; danger?: boolean; first?: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}>
      <Feather name={props.icon} size={18} color={props.danger ? colors.danger : colors.text} />
      <Text style={[styles.menuText, props.danger && { color: colors.danger }]}>{props.title}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  lead: { fontSize: 13, color: colors.muted, marginTop: 12 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  meta: { fontSize: 13, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  pressedFade: { opacity: 0.6 },
  grow: { flex: 1, minWidth: 0 },
  lineLabel: { width: 96, fontSize: 13, color: colors.muted },
  value: { fontSize: 15, fontWeight: '500', color: colors.text },
  add: { fontSize: 15, fontWeight: '600', color: colors.primary },
  note: { fontSize: 12, color: colors.muted, marginTop: 2 },
  namesRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  switchCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginTop: 10 },
  switchLabel: { fontSize: 15, color: colors.text },
  menu: { marginTop: 10 },
  menuText: { fontSize: 15, color: colors.text },
  sheetActions: { marginTop: 16, gap: 10 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  pickName: { fontSize: 15, color: colors.text },
}));
