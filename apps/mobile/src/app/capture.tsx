import { useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatMoney, formatRupees } from '@money-plant/core';
import { anonymiseSms, parseAnySms, parseBankText, type SmsParseResult } from '@money-plant/parser';
import { addMonthsToDate, dateKey, type DateKey } from '@money-plant/core';
import { FormScroll } from '@/components/keyboard';
import { DateField } from '@/components/date-fields';
import { Button, Card, Chip, Chips, ErrorText, Field, MoneyCard, figures, radius, useColors, makeStyles } from '@/components/ui';
import { formatDate, formatDateTime } from '@/components/format';
import { Badge, LinkRow, OptionRow } from '@/components/option-row';
import { Sheet } from '@/components/sheet';
import { useIsAdmin } from '@/lib/admin';
import { DEFAULT_IMPORT_MONTHS, hasImportedInbox, importInbox, importRange, retryFailedMessages, type ImportProgress } from '@/lib/capture';
import { captureStats } from '@/lib/ledger';
import { addSender, forgetSender, ignoreSender, linkSender, listSenderRows, type SenderRow } from '@/lib/senders';
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
  const [stats, imported, senders] = await Promise.all([captureStats(), hasImportedInbox(), listSenderRows()]);
  return {
    ...stats,
    senderRows: senders,
    imported,
    smsPermission: hasSmsPermission(),
    notificationAccess: isNotificationAccessGranted(),
  };
}

const initial: Awaited<ReturnType<typeof load>> = {
  senders: [],
  senderRows: [],
  failures: [],
  lastReceivedAt: null,
  imported: false,
  smsPermission: false,
  notificationAccess: false,
};

/** "4 min ago", "3 h ago", "2 days ago", or the date for anything older. */
function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} ${days === 1 ? 'day' : 'days'} ago` : formatDate(iso);
}

type Open = 'range' | 'failures' | 'test' | 'add' | { sender: string };

/**
 * CAP-2, CAP-8, CAP-11 (decision 0028): a status card that says whether bank
 * SMS are being read, then rows that open sheets: older messages, a bank
 * statement, each sender, and help for messages the app couldn't read.
 */
export default function Capture() {
  const colors = useColors();
  const styles = useStyles();
  const admin = useIsAdmin();
  const { data, reload } = useLedger(load, initial);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
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
    setOpen(null);
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

  const read = data.senderRows.reduce((sum, s) => sum + s.parsed, 0);
  const reading = data.smsPermission;
  const sender = typeof open === 'object' && open !== null ? data.senderRows.find((s) => s.sender === open.sender) : undefined;
  const close = () => setOpen(null);

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <MoneyCard>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: reading ? colors.heroAccent : colors.heroWarning }]} />
          <Text style={[styles.statusText, { color: reading ? colors.heroAccent : colors.heroWarning }]}>
            {reading ? 'Reading new messages' : 'Not reading SMS yet'}
          </Text>
        </View>
        <Text style={styles.heroTitle}>
          {busy ? 'Reading messages…' : data.lastReceivedAt ? `Last message ${ago(data.lastReceivedAt)}` : reading ? 'Nothing read yet' : 'Allow SMS to start'}
        </Text>
        {!reading && (
          <Pressable accessibilityRole="button" onPress={grant} style={({ pressed }) => [styles.heroButton, pressed && styles.pressedFade]}>
            <Text style={styles.heroButtonText}>Allow reading SMS</Text>
          </Pressable>
        )}
        <View style={styles.heroLine} />
        <Check on={reading} text={reading ? 'SMS permission allowed' : 'SMS permission not allowed yet'} />
        <Check
          on={data.notificationAccess}
          text="Payee names from UPI apps"
          action={data.notificationAccess ? undefined : { label: 'Turn on', onPress: openNotificationAccessSettings }}
        />
        {read > 0 && <Check on text={`${read.toLocaleString('en-IN')} messages read`} />}
        <Text style={styles.heroNote}>
          {readsAnySender ? 'Any bank or business, never people. ' : 'This version reads only a few banks; install the latest Money Plant to read any bank. '}
          Message text stays on this phone. Only the amount, account digits, payee and reference sync.
        </Text>
      </MoneyCard>

      {progress && (
        <Text style={styles.progress}>
          Read {progress.read} messages · {progress.created} new entries · {progress.merged} merged
        </Text>
      )}
      {error && <ErrorText>{error}</ErrorText>}

      <View>
        <Text style={styles.section}>Fill in the past</Text>
        <Card>
          <LinkRow
            first
            icon="message-square"
            title="Read older SMS"
            meta={data.imported ? 'Pick a range · messages already read are skipped' : 'Pick how far back; the app finds your accounts in them'}
            onPress={() => setOpen('range')}
          />
          <LinkRow icon="file-text" title="Import a bank statement" meta="PDF, for months before your SMS or messages that never came" onPress={() => router.push('/statement-import')} />
        </Card>
      </View>

      <View>
        <View style={styles.sectionLine}>
          <Text style={styles.section}>Senders{data.senderRows.length > 0 ? ` · ${data.senderRows.length}` : ''}</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen('add')}>
            <Text style={styles.sectionAction}>Add</Text>
          </Pressable>
        </View>
        {data.senderRows.length === 0 ? (
          <Text style={styles.body}>Nothing read yet.</Text>
        ) : (
          <Card>
            {data.senderRows.map((s, i) => {
              const needsAccount = !s.ignored && !s.account && s.waiting > 0;
              return (
                <LinkRow
                  key={s.sender}
                  first={i === 0}
                  letters={s.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'}
                  title={s.name}
                  meta={senderMeta(s)}
                  trailing={needsAccount ? <Badge label="Pick account" /> : undefined}
                  onPress={() => setOpen({ sender: s.sender })}
                />
              );
            })}
          </Card>
        )}
      </View>

      <View>
        <Text style={styles.section}>Help the app read your bank</Text>
        <Card>
          {data.failures.length > 0 && (
            <LinkRow
              first
              icon="alert-circle"
              tone="warning"
              title={`${data.failures.length} ${data.failures.length === 1 ? 'message' : 'messages'} it couldn't read`}
              meta="Share an anonymised copy, or try again"
              onPress={() => setOpen('failures')}
            />
          )}
          <LinkRow first={data.failures.length === 0} icon="check-square" title="Test a message" meta="Paste one to see what the app reads" onPress={() => setOpen('test')} />
        </Card>
      </View>

      <Sheet visible={open === 'range'} onClose={close} title="Read older SMS">
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
        <Button
          title={range === 'custom' ? 'Import these dates' : `Import last ${range === 1 ? 'month' : `${range} months`}`}
          onPress={() => run(() => importRange(from, to, setProgress))}
          loading={busy}
          disabled={!data.smsPermission}
        />
        {data.imported && (
          <Button title="Check for new messages" variant="secondary" onPress={() => run(() => importInbox(setProgress))} disabled={busy || !data.smsPermission} />
        )}
        {!data.smsPermission && <Text style={styles.hint}>Allow reading SMS first.</Text>}
      </Sheet>

      <Sheet visible={!!sender} onClose={close} title={sender?.name}>
        {sender && <SenderChoices row={sender} onDone={() => { close(); reload(); }} onError={setError} />}
      </Sheet>

      <Sheet visible={open === 'add'} onClose={close} title="Add a sender">
        <AddSender onDone={() => { close(); reload(); }} onError={setError} />
      </Sheet>

      <Sheet visible={open === 'failures'} onClose={close} title="Messages it couldn't read" tall>
        <ScrollView contentContainerStyle={styles.sheetList} keyboardShouldPersistTaps="handled">
          <Text style={styles.body}>
            These never became entries, so nothing was guessed. Tap one to share an anonymised copy{admin ? '' : ' with Deva'}, so the app learns to read it.
          </Text>
          {data.failures.map((f) => (
            <Failure key={f.fingerprint} failure={f} admin={admin} />
          ))}
          <Button title="Try these again" variant="secondary" onPress={retry} loading={busy} />
        </ScrollView>
      </Sheet>

      <Sheet visible={open === 'test'} onClose={close} title="Test a message">
        <TestMessage />
      </Sheet>
    </FormScroll>
  );
}

function senderMeta(s: SenderRow): string {
  const where = s.ignored ? 'Ignored' : s.account ? s.account.name : s.waiting > 0 ? `${s.waiting} waiting for an account` : 'No account yet';
  const counts = [`${s.parsed} read`, s.failed > 0 ? `${s.failed} couldn't read` : null].filter(Boolean).join(' · ');
  return s.ignored ? where : `${where} · ${counts}`;
}

/** A line on the status card: a tick (or a dash) and what it means. */
function Check({ on, text, action }: { on: boolean; text: string; action?: { label: string; onPress: () => void } }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.check}>
      <View style={styles.checkDot}>
        <Feather name={on ? 'check' : 'minus'} size={12} color={on ? colors.heroAccent : colors.heroMuted} />
      </View>
      <Text style={styles.checkText}>{text}</Text>
      {action && (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={action.onPress}>
          <Text style={styles.checkAction}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** CAP-11: one sender's counts and what can be done with it. */
function SenderChoices({ row, onDone, onError }: { row: SenderRow; onDone: () => void; onError: (message: string) => void }) {
  const styles = useStyles();
  const [linking, setLinking] = useState(false);
  const act = (work: () => Promise<unknown>) => void work().then(onDone, (e) => onError(e instanceof Error ? e.message : String(e)));
  return (
    <>
      <Text style={styles.body}>{row.ignored ? 'Ignored: its messages never become entries.' : row.account ? `Messages go to ${row.account.name}.` : "Messages wait until you pick which account they're for."}</Text>
      <View style={styles.stats}>
        <Stat label="Read" value={row.parsed} />
        <Stat label="Skipped" value={row.skipped} />
        <Stat label="Couldn't read" value={row.failed} warn={row.failed > 0} />
      </View>
      <Text style={styles.hint}>Skipped means OTPs, offers, reminders and failed payments.</Text>
      {!row.ignored && (
        <OptionRow
          icon="link"
          title={row.account ? 'Change account' : 'Pick the account'}
          meta={row.account ? row.account.name : row.waiting > 0 ? `${row.waiting} ${row.waiting === 1 ? 'message waits' : 'messages wait'}` : undefined}
          onPress={() => setLinking(true)}
        />
      )}
      {row.account && <OptionRow icon="rotate-ccw" title="Unlink" meta="Ask again which account it's for" onPress={() => act(() => forgetSender(row.sender))} />}
      {row.ignored ? (
        <OptionRow icon="refresh-cw" title="Read it again" meta="Its new messages become entries" onPress={() => act(() => forgetSender(row.sender))} />
      ) : (
        <OptionRow icon="slash" title="Ignore this sender" meta="Its messages won't become entries" tone="danger" onPress={() => act(() => ignoreSender(row.sender))} />
      )}
      <AccountPicker
        visible={linking}
        title="Messages from this sender are for"
        onClose={() => setLinking(false)}
        onPick={(account) => {
          setLinking(false);
          act(() => linkSender(row.sender, account.account.id));
        }}
      />
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warn && { color: colors.warning }]}>{value.toLocaleString('en-IN')}</Text>
    </View>
  );
}

/** CAP-8: a sender added before its first message, linked to its account. */
function AddSender({ onDone, onError }: { onDone: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState('');
  const [linking, setLinking] = useState(false);
  return (
    <>
      <Field label="Sender name, as Messages shows it" value={name} onChangeText={setName} autoCapitalize="characters" placeholder="ENBD" />
      <Button title="Pick its account" onPress={() => setLinking(true)} disabled={!name.trim()} />
      <AccountPicker
        visible={linking}
        title={`Messages from ${name.trim()} are for`}
        onClose={() => setLinking(false)}
        onPick={(account) => {
          setLinking(false);
          void addSender(name.trim(), account.account.id).then(onDone, (e) => onError(e instanceof Error ? e.message : String(e)));
        }}
      />
    </>
  );
}

function Failure({ failure, admin }: { failure: { fingerprint: string; sender: string; receivedAt: string; rawText: string | null }; admin: boolean }) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.failure}>
      <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}>
        <Text style={styles.failureTitle}>
          {failure.sender} · {formatDateTime(failure.receivedAt)}
        </Text>
      </Pressable>
      {expanded && failure.rawText && <ShareSample sender={failure.sender} rawText={failure.rawText} admin={admin} />}
    </View>
  );
}

/**
 * CAP-9: the one way message text leaves the phone. The phone replaces digits,
 * names, UPI IDs and emails, shows the result for the user to check and edit,
 * and opens the share sheet only when they tap Share. Nothing is sent on its own.
 */
function ShareSample({ sender, rawText, admin }: { sender: string; rawText: string; admin: boolean }) {
  const styles = useStyles();
  const [text, setText] = useState(() => anonymiseSms(rawText));
  return (
    <View style={styles.sample}>
      <Text style={styles.hint}>Check it before sharing: names, account digits, amounts and references are replaced. Edit anything that still looks personal.</Text>
      <TextInput value={text} onChangeText={setText} multiline style={styles.sampleInput} />
      <Button
        title={admin ? 'Share' : 'Share with Deva'}
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
  const [sender, setSender] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<SmsParseResult | null>(null);
  const read = () => setResult(sender.trim() ? parseAnySms({ sender: sender.trim(), body: text }) : parseBankText(null, text));
  return (
    <>
      <Field label="Sender (optional), as Messages shows it" value={sender} onChangeText={setSender} autoCapitalize="characters" placeholder="AX-HDFCBK" />
      <Field label="Message text" value={text} onChangeText={setText} multiline style={styles.input} placeholder="Paste a bank SMS" />
      <View style={styles.actions}>
        <Button title="Read it" variant="secondary" onPress={read} disabled={text.trim() === ''} />
      </View>
      {result && <Text selectable style={styles.raw}>{describe(result)}</Text>}
    </>
  );
}

function describe(result: SmsParseResult): string {
  if (result.status === 'ignored' && result.reason === 'unknown_sender') return "Skipped: that sender looks like a person, and messages from people are never read.";
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

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, paddingBottom: 48, gap: 16 },
  body: { fontSize: 14, color: colors.secondary, lineHeight: 20 },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  progress: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },
  heroTitle: { fontSize: 22, fontWeight: '700', color: colors.heroText },
  heroButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 14, backgroundColor: colors.heroAccent },
  heroButtonText: { fontSize: 15, fontWeight: '700', color: colors.hero },
  heroLine: { height: 1, backgroundColor: colors.heroLine },
  heroNote: { fontSize: 12, color: colors.heroMuted, lineHeight: 17 },
  pressedFade: { opacity: 0.7 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.heroPill, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, fontSize: 13, color: colors.heroText },
  checkAction: { fontSize: 13, fontWeight: '600', color: colors.heroAccent },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6, marginHorizontal: 4 },
  sectionLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionAction: { fontSize: 13, fontWeight: '600', color: colors.primary, marginHorizontal: 4 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  statLabel: { fontSize: 12, color: colors.muted },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 2, ...figures },
  sheetList: { gap: 10, paddingBottom: 16 },
  failure: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.divider },
  failureTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
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
}));
