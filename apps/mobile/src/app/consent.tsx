import { type ComponentProps, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { addMonthsToDate, dateKey } from '@money-plant/core';
import { FormScroll } from '@/components/keyboard';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { importRange, type ImportProgress } from '@/lib/capture';
import { agreedBefore, giveConsent } from '@/lib/consent';
import { getMe, updateMe } from '@/lib/me';
import { signOut } from '@/lib/session';
import { startSetup } from '@/lib/setup';
import { hasSmsPermission, isSmsReaderAvailable } from '../../modules/sms-reader';

type Icon = ComponentProps<typeof Feather>['name'];

const POINTS: { icon: Icon; title: string; body: string }[] = [
  {
    icon: 'message-square',
    title: 'Bank SMS stay on this phone',
    body: 'With your permission, the app reads messages from banks and card companies only. The message text never leaves the phone; only the amount, date, account and payee are saved.',
  },
  {
    icon: 'cloud',
    title: 'Your ledger is kept in the cloud',
    body: 'Entries, accounts, budgets and IOUs sync to your account on Supabase (Mumbai), so a new phone gets them back. Other users can read none of it; a friend sees only an IOU you share with them.',
  },
  {
    icon: 'eye',
    title: 'Deva runs the server',
    body: "Money Plant is run by Deva for friends, not by a company. As the server's admin, Deva could technically see your entries. Deva doesn't look, and the weekly backups are encrypted.",
  },
  {
    icon: 'users',
    title: 'Contacts are matched on the phone',
    body: 'If you allow contacts, payees are matched to names on this phone. Your contacts are never uploaded.',
  },
  {
    icon: 'file-text',
    title: 'Statements are read, not kept',
    body: 'A bank statement or CAS PDF you import goes to the statement reader once, to be read. It returns only the rows, never your name or address, and keeps nothing.',
  },
  {
    icon: 'cpu',
    title: "AI runs on Deva's computer",
    body: "An AI model suggests categories for shops the app doesn't know and writes your month review. It runs on Deva's own PC, not with an AI company, and gets only what each task needs, such as a shop's name, a rough amount and your category names: never SMS text, account numbers or phone numbers. You can turn AI off in Settings.",
  },
];

const WELCOME: { icon: Icon; text: string }[] = [
  { icon: 'message-square', text: 'Your bank SMS fill the ledger, so there is little to type' },
  { icon: 'pie-chart', text: 'Budgets tell you mid-month if you are heading over' },
  { icon: 'users', text: 'IOUs with friends settle through your own UPI app' },
];

const RANGES = [1, 3, 6, 12] as const;

type Step = 'welcome' | 'consent' | 'profile' | 'sms';

/**
 * ACC-5 and ACC-10: the first run. A new user sees a welcome, the consent
 * points, their name and UPI ID, then SMS access and how far back to read.
 * Someone who agreed to an earlier version on this phone sees only the
 * consent points again. Nothing is shown in the app until the last step.
 */
export default function FirstRun() {
  const [returning, setReturning] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('welcome');

  useEffect(() => {
    agreedBefore().then(
      (before) => {
        setReturning(before);
        if (before) setStep('consent');
      },
      () => setReturning(false),
    );
  }, []);

  async function finish() {
    if (!returning) await startSetup();
    await giveConsent();
  }

  if (returning === null) return <SafeAreaView style={styles.safe} />;
  const smsStep = Platform.OS === 'android' && isSmsReaderAvailable;
  const total = smsStep ? 3 : 2;

  return (
    <SafeAreaView style={styles.safe}>
      {step === 'welcome' && <Welcome onNext={() => setStep('consent')} />}
      {step === 'consent' && (
        <Consent
          returning={returning}
          stepLabel={returning ? null : `Step 1 of ${total}`}
          onAgree={async () => (returning ? finish() : setStep('profile'))}
        />
      )}
      {step === 'profile' && <Profile stepLabel={`Step 2 of ${total}`} onNext={async () => (smsStep ? setStep('sms') : finish())} />}
      {step === 'sms' && <Sms stepLabel={`Step 3 of ${total}`} onDone={finish} />}
    </SafeAreaView>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.title}>Welcome to Money Plant</Text>
      <Text style={styles.subtitle}>All your money in one place, kept up to date in a couple of minutes a day.</Text>
      {WELCOME.map((w) => (
        <View key={w.text} style={styles.welcomeRow}>
          <View style={styles.icon}>
            <Feather name={w.icon} size={18} color={colors.primary} />
          </View>
          <Text style={[styles.body, styles.grow, styles.welcomeText]}>{w.text}</Text>
        </View>
      ))}
      <Text style={styles.body}>Setting up takes about a minute.</Text>
      <View style={styles.actions}>
        <Button title="Get started" onPress={onNext} />
      </View>
    </FormScroll>
  );
}

function Consent(props: { returning: boolean; stepLabel: string | null; onAgree: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await props.onAgree();
    } catch (e) {
      setError(`Couldn't save that: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      {props.stepLabel && <Text style={styles.step}>{props.stepLabel}</Text>}
      <Text style={styles.title}>{props.returning ? 'What changed' : 'Your data'}</Text>
      <Text style={styles.subtitle}>
        {props.returning
          ? 'Money Plant is opening up to friends, so the notes below now say who runs the server. Please read them once more.'
          : "Money Plant fills your ledger mostly from bank SMS. Here's what happens to your data."}
      </Text>
      {POINTS.map((p) => (
        <View key={p.title} style={styles.point}>
          <View style={styles.icon}>
            <Feather name={p.icon} size={18} color={colors.primary} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.pointTitle}>{p.title}</Text>
            <Text style={styles.body}>{p.body}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.body}>You can export everything, clear it, or delete your account any time from Profile and settings.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="I agree" onPress={agree} loading={busy} />
        <Button title="Not now, sign out" variant="secondary" onPress={signOut} disabled={busy} />
      </View>
    </FormScroll>
  );
}

function Profile({ stepLabel, onNext }: { stepLabel: string; onNext: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [vpa, setVpa] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe().then((me) => {
      setName(me.name ?? '');
      setVpa(me.vpa ?? '');
    }, () => {});
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateMe({ name, vpa });
      await onNext();
    } catch (e) {
      setError(e instanceof Error ? `${e.message}. Saving needs the internet; you can also skip this for now.` : String(e));
      setBusy(false);
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.step}>{stepLabel}</Text>
      <Text style={styles.title}>About you</Text>
      <Text style={styles.subtitle}>Friends see your name on IOUs you share, and your UPI ID lets them pay you back in one tap.</Text>
      <Field label="Your name" value={name} onChangeText={setName} placeholder="Ravi" maxLength={80} />
      <Field label="Your UPI ID (optional)" value={vpa} onChangeText={setVpa} placeholder="ravi@okhdfcbank" autoCapitalize="none" autoCorrect={false} />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Continue" onPress={save} loading={busy} disabled={!name.trim()} />
        <Button title="Skip for now" variant="secondary" onPress={() => void onNext()} disabled={busy} />
      </View>
    </FormScroll>
  );
}

function Sms({ stepLabel, onDone }: { stepLabel: string; onDone: () => Promise<unknown> }) {
  const [allowed, setAllowed] = useState(hasSmsPermission());
  const [months, setMonths] = useState<(typeof RANGES)[number]>(6);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allow() {
    setError(null);
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    const ok = Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
    setAllowed(ok);
    if (!ok) setError('Both SMS permissions are needed. You can allow them later in Android Settings → Apps → Money Plant → Permissions.');
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const day = dateKey(new Date());
      setProgress(await importRange(addMonthsToDate(day, -months), day, setProgress));
      setImported(true);
    } catch (e) {
      setError(`Couldn't read the messages: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.step}>{stepLabel}</Text>
      <Text style={styles.title}>Read your bank SMS</Text>
      <Text style={styles.subtitle}>
        Money Plant reads messages from ICICI, HDFC, HSBC, SBI and slice only, and finds your accounts and cards in them. The text never leaves this phone.
      </Text>
      {!allowed ? (
        <Button title="Allow reading SMS" onPress={() => void allow()} />
      ) : (
        <>
          <Text style={styles.pointTitle}>How far back?</Text>
          <Chips>
            {RANGES.map((m) => (
              <Chip key={m} label={m === 1 ? '1 month' : `${m} months`} selected={months === m} onPress={() => setMonths(m)} />
            ))}
          </Chips>
          {progress && (
            <Text style={styles.body}>
              Read {progress.read} messages · {progress.created} new entries
            </Text>
          )}
          {!imported && <Button title="Read my messages" onPress={() => void read()} loading={busy} />}
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <Text style={styles.body}>
        Other banks may not be read correctly yet. Messages the app can't read are listed in Settings → Bank SMS, so they're never guessed into wrong entries.
      </Text>
      <View style={styles.actions}>
        <Button title={imported ? 'Open Money Plant' : 'Skip for now'} variant={imported ? 'primary' : 'secondary'} onPress={() => void onDone()} disabled={busy} />
      </View>
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, paddingBottom: 48, gap: 16 },
  step: { fontSize: 13, fontWeight: '600', color: colors.primary, marginTop: 16 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, marginTop: 4 },
  subtitle: { fontSize: 16, color: colors.muted, lineHeight: 22 },
  point: { flexDirection: 'row', gap: 14 },
  welcomeRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  pointTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  welcomeText: { color: colors.text, fontSize: 15 },
  actions: { marginTop: 8, gap: 12 },
});
