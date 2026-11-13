import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { currencyInfo, dateKey, paise } from '@money-plant/core';
import { mobileDigits } from '@money-plant/matcher';
import { FormScroll } from '@/components/keyboard';
import { formatAmount, formatSummary } from '@/components/format';
import { ItemRow } from '@/components/people-rows';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, MoneyCard, SectionTitle, figures, useColors, makeStyles } from '@/components/ui';
import { pickContact } from '@/lib/contacts';
import { linkForEmail } from '@/lib/friends';
import { getMe } from '@/lib/me';
import { createItem, itemsWith, personTotals, reminderMessage, type ItemView } from '@/lib/shared';
import { createPerson, getPerson, phoneOf, type Person } from '@/lib/people';
import { useLedger } from '@/lib/use-ledger';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** How many settled items show before "See all". */
const SETTLED_SHOWN = 3;

/** Less than one whole unit of its currency (under ₹1): what is left over from splitting a bill. */
function isCrumb(b: { currency: Person['balances'][number]['currency']; amount: number }): boolean {
  return Math.abs(b.amount) < 10 ** currencyInfo(b.currency).decimals;
}

/**
 * A person (decision 0027 revamp): where you stand with them in a money card
 * with one Settle up button, round shortcuts, then open and settled items.
 * Their details (decision 0025) are behind the pencil, on person/details.
 */
export default function PersonPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return id === 'new' ? <NewPerson /> : <PersonOverview id={id} />;
}

function PersonOverview({ id }: { id: string }) {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation();
  const load = useCallback(async () => {
    const [person, items, totals] = await Promise.all([getPerson(id), itemsWith(id), personTotals(id)]);
    return { person, items, gap: totals.gap as Map<string, number>, loaded: true };
  }, [id]);
  const { data } = useLedger(load, { person: null as Person | null, items: [] as ItemView[], gap: new Map<string, number>(), loaded: false });
  const person = data.person;
  const [onMoneyPlant, setOnMoneyPlant] = useState(false);
  const [allSettled, setAllSettled] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = person?.account.email ?? null;

  useEffect(() => {
    navigation.setOptions({
      title: '',
      headerRight: person
        ? () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Details" hitSlop={8} onPress={() => router.push(`/person/details?id=${id}`)} style={styles.headerButton}>
              <Feather name="edit-2" size={18} color={colors.text} />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, person, id, colors.text, styles.headerButton]);

  useEffect(() => {
    if (!email) return setOnMoneyPlant(false);
    linkForEmail(email).then(
      (link) => setOnMoneyPlant(link?.state === 'friends'),
      () => setOnMoneyPlant(false),
    );
  }, [email]);

  if (!person) {
    return <View style={styles.container}>{data.loaded && <Text style={styles.empty}>They're no longer in your people.</Text>}</View>;
  }

  const name = person.account.name;
  const open = data.items.filter((v) => v.status !== 'linked' && v.status !== 'declined');
  const settled = data.items.filter((v) => !open.includes(v));
  const shownSettled = allSettled ? settled : settled.slice(0, SETTLED_SHOWN);
  const owing = person.balances.filter((b) => !isCrumb(b));
  const crumbs = person.balances.filter(isCrumb);
  const square = owing.length === 0;
  const theyOwe = owing.some((b) => b.amount > 0);
  // Paying them (IOU-3): copy their UPI ID or number, their QR, or the old direct link, on person/pay.
  const canPay = person.balances.some((b) => b.currency === 'INR' && b.amount < 0) && Boolean(person.account.vpa || phoneOf(person));

  // Settles what is left under ₹1 another way: no money moves (decision 0027).
  async function clearCrumbs() {
    setClearing(true);
    setError(null);
    try {
      for (const b of crumbs) {
        await createItem(
          { personId: id, kind: 'repayment', flow: b.amount > 0 ? 'to_me' : 'to_them', amount: paise(Math.abs(b.amount)), occurredOn: dateKey(new Date()), reason: 'Left over from rounding' },
          { outside: true, currency: b.currency },
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  }

  async function remind() {
    try {
      await Share.share({ message: reminderMessage(person!, await getMe()) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const shortcuts: { icon: FeatherName; label: string; onPress: () => void }[] = [
    { icon: 'users', label: 'Split', onPress: () => router.push(`/split?person=${id}`) },
    { icon: 'arrow-up-right', label: 'Lend', onPress: () => router.push(`/item/new?person=${id}&kind=loan&flow=to_them`) },
    ...(theyOwe ? [{ icon: 'bell' as const, label: 'Remind', onPress: remind }] : []),
    ...(canPay ? [{ icon: 'send' as const, label: 'Pay by UPI', onPress: () => router.push(`/person/pay?id=${id}`) }] : []),
  ];
  if (shortcuts.length < 4) shortcuts.push({ icon: 'arrow-down-left', label: 'Borrow', onPress: () => router.push(`/item/new?person=${id}&kind=loan&flow=to_me`) });

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <View style={styles.who}>
        <Initial name={name} size={48} />
        <View style={styles.grow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {onMoneyPlant && <Text style={styles.linked}>On Money Plant</Text>}
        </View>
      </View>

      <MoneyCard>
        {square ? (
          <>
            <Text style={styles.heroValue}>All square</Text>
            <Text style={styles.heroNote}>
              {crumbs.length === 0 ? (
                'Nothing open between you.'
              ) : (
                <>
                  {crumbs.map((b) => formatAmount(Math.abs(b.amount), b.currency)).join(' and ')} is left over from splitting a bill.{' '}
                  <Text accessibilityRole="button" onPress={clearing ? undefined : clearCrumbs} style={styles.heroLink}>
                    {clearing ? 'Clearing…' : 'Clear it'}
                  </Text>
                </>
              )}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.heroLabel}>
              {owing.every((b) => b.amount > 0) ? `${name} owes you` : owing.every((b) => b.amount < 0) ? `You owe ${name}` : 'Between you'}
            </Text>
            {/* Each currency on its own line, never added together (decision 0017). */}
            {owing.map((b) => (
              <Text key={b.currency} style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                {owing.some((o) => o.amount > 0) && owing.some((o) => o.amount < 0) ? (b.amount > 0 ? 'They owe ' : 'You owe ') : ''}
                {formatSummary(Math.abs(b.amount), b.currency)}
              </Text>
            ))}
            <Pressable accessibilityRole="button" onPress={() => router.push(`/settle?person=${id}`)} style={({ pressed }) => [styles.heroButton, pressed && styles.pressedFade]}>
              <Text style={styles.heroButtonText}>Settle up</Text>
            </Pressable>
          </>
        )}
      </MoneyCard>

      {[...data.gap].map(([currency, amount]) => (
        <Text key={currency} style={styles.hint}>
          {formatAmount(Math.abs(amount), currency)} of what you and {name} share isn't in your ledger yet. Link your entries below.
        </Text>
      ))}
      {error && <ErrorText>{error}</ErrorText>}

      <View style={styles.shortcuts}>
        {shortcuts.map((s) => (
          <Pressable key={s.label} accessibilityRole="button" accessibilityLabel={s.label} onPress={s.onPress} style={({ pressed }) => [styles.shortcut, pressed && styles.pressedFade]}>
            <View style={styles.shortcutIcon}>
              <Feather name={s.icon} size={20} color={colors.text} />
            </View>
            <Text style={styles.shortcutLabel} numberOfLines={1}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {open.length > 0 && (
        <>
          <SectionTitle>Open</SectionTitle>
          <Card>
            {open.map((v, i) => (
              <ItemRow key={v.id} view={v} first={i === 0} />
            ))}
          </Card>
        </>
      )}
      {settled.length > 0 && (
        <>
          <SectionTitle>Settled</SectionTitle>
          <Card>
            {shownSettled.map((v, i) => (
              <ItemRow key={v.id} view={v} first={i === 0} />
            ))}
            {settled.length > SETTLED_SHOWN && (
              <Pressable accessibilityRole="button" onPress={() => setAllSettled(!allSettled)} style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}>
                <Text style={styles.seeAllText}>{allSettled ? 'Show fewer' : `See all ${settled.length}`}</Text>
              </Pressable>
            )}
          </Card>
        </>
      )}
      {data.items.length === 0 && <Text style={styles.empty}>Nothing with {name} yet. Split a bill or record a loan to start.</Text>}
    </FormScroll>
  );
}

/** Adding someone: a name, or a phone contact. The rest is on their details once they exist. */
function NewPerson() {
  const styles = useStyles();
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: 'Add a person' });
  }, [navigation]);

  async function linkContact() {
    try {
      const picked = await pickContact();
      if (!picked) return;
      setContact(picked);
      if (!name.trim()) setName(picked.name);
      // Decision 0021: the contact's mobile number recognises their number-based UPI IDs.
      setPhone(picked.phones.map(mobileDigits).find((m): m is string => m !== null) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const created = await createPerson({ name, contactId: contact?.id ?? null, phone });
      router.replace(`/person/${created}`);
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} autoFocus />
      {Platform.OS === 'android' && (
        <>
          <Text style={styles.label}>Phone contact</Text>
          <Chips>
            <Chip label={contact ? contact.name : 'Pick from contacts'} selected={contact !== null} onPress={linkContact} />
            {contact && (
              <Chip
                label="Unlink"
                selected={false}
                onPress={() => {
                  setContact(null);
                  setPhone(null);
                }}
              />
            )}
          </Chips>
        </>
      )}
      <Text style={styles.hint}>Add their UPI ID, email and bank accounts later from the pencil on their page.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Add" onPress={add} loading={saving} />
      </View>
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  headerButton: { padding: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  linked: { fontSize: 13, fontWeight: '500', color: colors.primary, marginTop: 2 },
  heroLabel: { fontSize: 13, fontWeight: '500', color: colors.heroMuted },
  heroValue: { fontSize: 36, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroNote: { fontSize: 13, color: colors.heroMuted, lineHeight: 19 },
  heroLink: { fontWeight: '600', color: colors.heroAccent, textDecorationLine: 'underline' },
  heroButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 14, backgroundColor: colors.heroAccent },
  heroButtonText: { fontSize: 15, fontWeight: '700', color: colors.hero },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  shortcuts: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
  shortcut: { flex: 1, alignItems: 'center', gap: 6 },
  shortcutIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutLabel: { fontSize: 12, fontWeight: '500', color: colors.text },
  seeAll: { paddingVertical: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider },
  seeAllText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  pressed: { backgroundColor: colors.pressed },
  pressedFade: { opacity: 0.7 },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: 8 },
  actions: { marginTop: 16, gap: 10 },
}));
