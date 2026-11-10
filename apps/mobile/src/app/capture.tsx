import { useState, type ReactNode } from 'react';
import { PermissionsAndroid, Platform, Pressable, Share, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney, formatRupees } from '@money-plant/core';
import { BANKS, BANK_NAMES, anonymiseSms, parseBankText, type BankId, type SmsParseResult } from '@money-plant/parser';
import { addMonthsToDate, dateKey, type DateKey } from '@money-plant/core';
import { FormScroll } from '@/components/keyboard';
import { DateField } from '@/components/date-fields';
import { Button, Chip, Chips, ErrorText, Field, makeStyles } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { DEFAULT_IMPORT_MONTHS, hasImportedInbox, importInbox, importRange, retryFailedMessages, type ImportProgress } from '@/lib/capture';
import { captureStats } from '@/lib/ledger';
import { addSender, appChoices, forgetSender, ignoreSender, linkSender, listSenderRows, setAppApproved, type SenderRow } from '@/lib/senders';
import { AccountPicker } from '@/components/account-picker';
import { useLedger } from '@/lib/use-ledger';
import {
  hasSmsPermission,
  isNotificationAccessGranted,
  isSmsReaderAvailable,
  openNotificationAccessSettings,
  readsAnySender,
} from '../../modules/sms-reader';

async function load() {
  const [stats, imported, senders, apps] = await Promise.all([captureStats(), hasImportedInbox(), listSenderRows(), appChoices()]);
  return {
    ...stats,
    senderRows: senders,
    apps: Object.entries(apps).map(([packageName, a]) => ({ packageName, ...a })),
    imported,
    smsPermission: hasSmsPermission(),
    notificationAccess: isNotificationAccessGranted(),
  };
}

const initial: Awaited<ReturnType<typeof load>> = {
  senders: [],
  senderRows: [],
  apps: [],
  failures: [],
  imported: false,
  smsPermission: false,
  notificationAccess: false,
};

export default function Capture() {
  const styles = useStyles();
  const { data, reload } = useLedger(load, initial);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [range, setRange] = useState<RangeChoice>(DEFAULT_IMPORT_MONTHS);
  const day = dateKey(new Date());
  const [custom, setCustom] = useState<{ from: DateKey; to: DateKey }>({ from: addMonthsToDate(day, -1), to: day });

  if (!isSmsReaderAvailable) {
    return (
      <View style={styles.container}>
        <Text style={styles.body}>
          Reading bank SMS needs the Money Plant development build on Android. It isn't available in Expo Go or on iPhone.
        </Text>
      </View>
    );
  }

  async function grant() {
    if (Platform.OS !== 'android') return;
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    if (Object.values(result).some((r) => r !== PermissionsAndroid.RESULTS.GRANTED)) {
      setError('Money Plant needs both SMS permissions. You can allow them in Android Settings → Apps → Money Plant → Permissions.');
    } else {
      setError(null);
    }
    reload();
  }

  async function run(work: () => Promise<ImportProgress>) {
    setBusy(true);
    setError(null);
    try {
      setProgress(await work());
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      reload();
    }
  }

  const from = range === 'custom' ? custom.from : addMonthsToDate(day, -range);
  const to = range === 'custom' ? custom.to : day;

  async function retry() {
    setBusy(true);
    await retryFailedMessages().catch(() => 0);
    setBusy(false);
    reload();
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        {readsAnySender
          ? 'Money Plant checks SMS from banks and other businesses, never from people, and reads only the ones about money. ICICI, HDFC, HSBC, SBI, PNB and slice have tuned rules; any other sender is read by a general reader and waits in Review until you say which account it is for.'
          : 'Money Plant reads messages only from ICICI, HDFC, HSBC, SBI and slice. The next app update reads any bank.'}{' '}
        The message text stays on this phone in the encrypted database. Only the amount, account digits, payee and reference are synced.
      </Text>
      <Text style={styles.hint}>
        If an entry looks wrong, or a message shows up below as unread, share it so the app learns to read that sender.
      </Text>

      <Section title="1. SMS permission">
        {data.smsPermission ? (
          <Text style={styles.ok}>Allowed. New bank SMS are added as they arrive.</Text>
        ) : (
          <Button title="Allow reading SMS" onPress={grant} />
        )}
      </Section>

      <Section title="2. Past messages">
        <Text style={styles.body}>
          {data.imported
            ? 'New bank SMS are read as they arrive. Import a range to add older ones; messages already read are skipped.'
            : 'Pick how far back to read. Money Plant finds your accounts and cards in these messages.'}
        </Text>
        <Chips>
          {RANGES.map((r) => (
            <Chip key={String(r.value)} label={r.label} selected={range === r.value} onPress={() => setRange(r.value)} />
          ))}
        </Chips>
        {range === 'custom' && (
          <View style={styles.dates}>
            <DateField label="From" value={custom.from} max={custom.to} onChange={(key) => key && setCustom((c) => ({ ...c, from: key }))} style={styles.grow} />
            <DateField label="To" value={custom.to} min={custom.from} max={day} onChange={(key) => key && setCustom((c) => ({ ...c, to: key }))} style={styles.grow} />
          </View>
        )}
        {progress && (
          <Text style={styles.body}>
            Read {progress.read} messages · {progress.created} new entries · {progress.merged} merged
          </Text>
        )}
        <Button
          title={range === 'custom' ? 'Import these dates' : `Import last ${range === 1 ? 'month' : `${range} months`}`}
          onPress={() => run(() => importRange(from, to, setProgress))}
          loading={busy}
          disabled={!data.smsPermission}
        />
        {data.imported && (
          <Button title="Check for new messages" variant="secondary" onPress={() => run(() => importInbox(setProgress))} disabled={busy || !data.smsPermission} />
        )}
        <Text style={styles.body}>Missing payments from before the SMS history, or messages that never came? A bank statement PDF fills them in.</Text>
        <Button title="Import a bank statement" variant="secondary" onPress={() => router.push('/statement-import')} disabled={busy} />
      </Section>

      <Section title="3. App notifications (optional)">
        <Text style={styles.body}>
          Adds payee names from Google Pay, PhonePe, your bank apps and slice to the matching SMS entry.
          {readsAnySender
            ? " When another app (Revolut, a bank abroad) shows a payment, Review asks once whether to read it. Apps you haven't said yes to are never read."
            : " Other apps' notifications are ignored."}
        </Text>
        {data.notificationAccess ? (
          <Text style={styles.ok}>Turned on.</Text>
        ) : (
          <Button title="Turn on in Android settings" variant="secondary" onPress={openNotificationAccessSettings} />
        )}
      </Section>

      {error && <ErrorText>{error}</ErrorText>}

      <Senders rows={data.senderRows} onChange={reload} onError={setError} />

      {data.apps.length > 0 && (
        <Section title="Other apps">
          {data.apps.map((a) => (
            <View key={a.packageName} style={styles.statRow}>
              <View style={styles.grow}>
                <Text style={styles.statSender}>{a.name}</Text>
                <Text style={styles.statText}>{a.state === 'approved' ? 'Payments are read' : a.state === 'denied' ? 'Not read' : 'Waiting for your answer in Review'}</Text>
              </View>
              <Switch
                value={a.state === 'approved'}
                accessibilityLabel={`Read payments from ${a.name}`}
                onValueChange={(on) => void setAppApproved(a.packageName, on).then(reload)}
              />
            </View>
          ))}
        </Section>
      )}

      {data.failures.length > 0 && (
        <Section title="Messages the app couldn't read">
          <Text style={styles.body}>
            These never became entries, so nothing was guessed. Tap one to share an anonymised copy with Deva, so the app learns
            to read it.
          </Text>
          {data.failures.map((f) => (
            <Pressable key={f.fingerprint} onPress={() => setExpanded(expanded === f.fingerprint ? null : f.fingerprint)} style={styles.failure}>
              <Text style={styles.statSender}>
                {f.sender} · {formatDateTime(f.receivedAt)}
              </Text>
              {expanded === f.fingerprint && f.rawText && <ShareSample sender={f.sender} rawText={f.rawText} />}
            </Pressable>
          ))}
          <Button title="Try these again" variant="secondary" onPress={retry} loading={busy} />
        </Section>
      )}

      <TestMessage />
    </FormScroll>
  );
}

/**
 * CAP-9: the one way message text leaves the phone. The phone replaces digits,
 * names, UPI IDs and emails, shows the result for the user to check and edit,
 * and opens the share sheet only when they tap Share. Nothing is sent on its own.
 */
function ShareSample({ sender, rawText }: { sender: string; rawText: string }) {
  const styles = useStyles();
  const [text, setText] = useState(() => anonymiseSms(rawText));
  return (
    <View style={styles.sample}>
      <Text style={styles.hint}>Check it before sharing: names, account digits, amounts and references are replaced. Edit anything that still looks personal.</Text>
      <TextInput value={text} onChangeText={setText} multiline style={styles.sampleInput} />
      <Button
        title="Share with Deva"
        variant="secondary"
        onPress={() => void Share.share({ message: `Money Plant sample (anonymised)\nSender: ${sender}\n\n${text}` })}
      />
    </View>
  );
}

type RangeChoice = 1 | 3 | 6 | 12 | 'custom';

/** CAP-2: the ranges offered for reading past SMS. */
const RANGES: { value: RangeChoice; label: string }[] = [
  { value: 1, label: '1 month' },
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '1 year' },
  { value: 'custom', label: 'Pick dates' },
];

/** Paste a message to see what the parser reads. Nothing is saved. */
function TestMessage() {
  const styles = useStyles();
  const [bank, setBank] = useState<BankId | null>('hdfc');
  const [text, setText] = useState('');
  const [result, setResult] = useState<SmsParseResult | null>(null);
  return (
    <Section title="Test a message">
      <View style={styles.chips}>
        {BANKS.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: option === bank }}
            onPress={() => setBank(option)}
            style={[styles.chip, option === bank && styles.chipSelected]}
          >
            <Text style={[styles.chipText, option === bank && styles.chipTextSelected]}>{BANK_NAMES[option]}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: bank === null }}
          onPress={() => setBank(null)}
          style={[styles.chip, bank === null && styles.chipSelected]}
        >
          <Text style={[styles.chipText, bank === null && styles.chipTextSelected]}>Any other sender</Text>
        </Pressable>
      </View>
      <Field label="Message text" value={text} onChangeText={setText} multiline style={styles.input} placeholder="Paste a bank SMS" />
      <View style={styles.actions}>
        <Button title="Read it" variant="secondary" onPress={() => setResult(parseBankText(bank, text))} disabled={text.trim() === ''} />
      </View>
      {result && <Text selectable style={styles.raw}>{describe(result)}</Text>}
    </Section>
  );
}

function describe(result: SmsParseResult): string {
  if (result.status !== 'parsed') return `${result.status === 'ignored' ? 'Skipped' : 'Not readable'}: ${result.reason}`;
  const t = result.transaction;
  return [
    `${t.direction === 'debit' ? 'Money out' : 'Money in'}: ${formatMoney(t.amount, t.currency ?? 'INR')}`,
    `Account: ${t.instrument}${t.accountLast ? ` ••${t.accountLast}` : ' (digits not found)'}`,
    `Payee: ${t.counterparty ?? '—'}`,
    `Reference: ${t.reference ?? '—'}`,
    `Balance: ${t.balance !== null ? formatRupees(t.balance) : '—'}`,
    `Read by: ${t.template} (confidence ${t.confidence})`,
  ].join('\n');
}

/**
 * CAP-11, CAP-8: every sender the app has seen, with its account and how its
 * messages were read. A sender without tuned rules can be linked to an
 * account, ignored, or asked about again; one can be added before its first message.
 */
function Senders({ rows, onChange, onError }: { rows: SenderRow[]; onChange: () => void; onError: (message: string) => void }) {
  const styles = useStyles();
  const [linking, setLinking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const act = (work: () => Promise<unknown>) => void work().then(onChange, (e) => onError(e instanceof Error ? e.message : String(e)));
  return (
    <Section title="Senders">
      {rows.length === 0 ? (
        <Text style={styles.body}>Nothing read yet.</Text>
      ) : (
        rows.map((s) => (
          <View key={s.sender} style={styles.senderRow}>
            <Text style={styles.statSender}>
              {s.name}
              {s.tuned ? ' · tuned rules' : ''}
            </Text>
            <Text style={[styles.statText, s.failed > 0 && styles.warn]}>
              {s.ignored ? 'Ignored · ' : s.account ? `Into ${s.account.name} · ` : !s.tuned ? 'Not linked yet · ' : ''}
              {s.parsed} read · {s.skipped} skipped · {s.failed} failed{s.waiting > 0 ? ` · ${s.waiting} waiting` : ''}
            </Text>
            {!s.tuned && (
              <View style={styles.chips}>
                <Chip label={s.account ? 'Change account' : 'Link to an account'} selected={false} onPress={() => setLinking(s.sender)} />
                {s.ignored || s.account ? (
                  <Chip label={s.ignored ? 'Read again' : 'Unlink'} selected={false} onPress={() => act(() => forgetSender(s.sender))} />
                ) : (
                  <Chip label="Ignore" selected={false} onPress={() => act(() => ignoreSender(s.sender))} />
                )}
              </View>
            )}
          </View>
        ))
      )}
      <Text style={styles.hint}>Skipped means OTPs, offers, reminders and failed payments.</Text>
      {adding ? (
        <>
          <Field label="Sender name, as Messages shows it" value={name} onChangeText={setName} autoCapitalize="characters" placeholder="ENBD" />
          <Button title="Pick its account" variant="secondary" onPress={() => setLinking(`new:${name}`)} disabled={!name.trim()} />
        </>
      ) : (
        <Button title="Add a sender" variant="secondary" onPress={() => setAdding(true)} />
      )}
      <AccountPicker
        visible={linking !== null}
        title="Messages from this sender are for"
        onClose={() => setLinking(null)}
        onPick={(account) => {
          const target = linking!;
          setLinking(null);
          if (target.startsWith('new:')) {
            act(() => addSender(target.slice(4), account.account.id));
            setAdding(false);
            setName('');
          } else act(() => linkSender(target, account.account.id));
        }}
      />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, paddingBottom: 48, gap: 16 },
  section: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  sectionBody: { marginTop: 8, gap: 8 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  hint: { fontSize: 13, color: colors.muted },
  ok: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  warn: { color: colors.warning },
  senderRow: { gap: 4, paddingVertical: 6 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  statSender: { fontSize: 14, fontWeight: '600', color: colors.text },
  statText: { fontSize: 14, color: colors.muted },
  failure: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  raw: { fontSize: 13, color: colors.text, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', marginTop: 4 },
  sample: { gap: 8, marginTop: 8 },
  sampleInput: {
    fontSize: 13,
    color: colors.text,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  input: { minHeight: 96, textAlignVertical: 'top', paddingVertical: 8 },
  actions: { marginTop: 8 },
  dates: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.pressed },
  chipText: { color: colors.text },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
}));
