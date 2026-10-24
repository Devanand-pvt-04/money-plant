import { useState, type ReactNode } from 'react';
import { PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatRupees } from '@money-plant/core';
import { BANKS, BANK_NAMES, parseBankText, type BankId, type SmsParseResult } from '@money-plant/parser';
import { addMonthsToDate, dateKey, type DateKey } from '@money-plant/core';
import { DateField } from '@/components/date-fields';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { DEFAULT_IMPORT_MONTHS, hasImportedInbox, importInbox, importRange, retryFailedMessages, type ImportProgress } from '@/lib/capture';
import { captureStats } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';
import {
  hasSmsPermission,
  isNotificationAccessGranted,
  isSmsReaderAvailable,
  openNotificationAccessSettings,
} from '../../modules/sms-reader';

async function load() {
  const [stats, imported] = await Promise.all([captureStats(), hasImportedInbox()]);
  return {
    ...stats,
    imported,
    smsPermission: hasSmsPermission(),
    notificationAccess: isNotificationAccessGranted(),
  };
}

const initial: Awaited<ReturnType<typeof load>> = {
  senders: [],
  failures: [],
  imported: false,
  smsPermission: false,
  notificationAccess: false,
};

export default function Capture() {
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        Money Plant reads messages only from ICICI, HDFC, HSBC, SBI and slice. The message text stays on this phone in the
        encrypted database. Only the amount, account digits, payee and reference are synced.
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
      </Section>

      <Section title="3. UPI app notifications (optional)">
        <Text style={styles.body}>
          Adds payee names from Google Pay, PhonePe, your bank apps and slice to the matching SMS entry. Other apps'
          notifications are ignored.
        </Text>
        {data.notificationAccess ? (
          <Text style={styles.ok}>Turned on.</Text>
        ) : (
          <Button title="Turn on in Android settings" variant="secondary" onPress={openNotificationAccessSettings} />
        )}
      </Section>

      {error && <ErrorText>{error}</ErrorText>}

      <Section title="How each bank is read">
        {data.senders.length === 0 ? (
          <Text style={styles.body}>Nothing read yet.</Text>
        ) : (
          data.senders.map((s) => (
            <View key={s.sender} style={styles.statRow}>
              <Text style={styles.statSender}>{s.sender}</Text>
              <Text style={[styles.statText, s.failed > 0 && styles.warn]}>
                {s.parsed} read · {s.ignored} skipped · {s.failed} failed
              </Text>
            </View>
          ))
        )}
        <Text style={styles.hint}>Skipped means OTPs, offers, reminders and failed payments.</Text>
      </Section>

      {data.failures.length > 0 && (
        <Section title="Messages the app couldn't read">
          <Text style={styles.body}>
            Tap one to see it. To help support it, copy it, replace your name, account digits and references, and share it
            with Deva.
          </Text>
          {data.failures.map((f) => (
            <Pressable key={f.fingerprint} onPress={() => setExpanded(expanded === f.fingerprint ? null : f.fingerprint)} style={styles.failure}>
              <Text style={styles.statSender}>
                {f.sender} · {formatDateTime(f.receivedAt)}
              </Text>
              {expanded === f.fingerprint && <Text selectable style={styles.raw}>{f.rawText}</Text>}
            </Pressable>
          ))}
          <Button title="Try these again" variant="secondary" onPress={retry} loading={busy} />
        </Section>
      )}

      <TestMessage />
    </ScrollView>
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
  const [bank, setBank] = useState<BankId>('hdfc');
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
    `${t.direction === 'debit' ? 'Money out' : 'Money in'}: ${formatRupees(t.amount)}`,
    `Account: ${t.instrument}${t.accountLast ? ` ••${t.accountLast}` : ' (digits not found)'}`,
    `Payee: ${t.counterparty ?? '—'}`,
    `Reference: ${t.reference ?? '—'}`,
    `Balance: ${t.balance !== null ? formatRupees(t.balance) : '—'}`,
    `Read by: ${t.template} (confidence ${t.confidence})`,
  ].join('\n');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 16 },
  section: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  sectionBody: { marginTop: 8, gap: 8 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  hint: { fontSize: 13, color: colors.muted },
  ok: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  warn: { color: colors.warning },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statSender: { fontSize: 14, fontWeight: '600', color: colors.text },
  statText: { fontSize: 14, color: colors.muted },
  failure: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  raw: { fontSize: 13, color: colors.text, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', marginTop: 4 },
  input: { minHeight: 96, textAlignVertical: 'top', paddingVertical: 8 },
  actions: { marginTop: 8 },
  dates: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.pressed },
  chipText: { color: colors.text },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
});
