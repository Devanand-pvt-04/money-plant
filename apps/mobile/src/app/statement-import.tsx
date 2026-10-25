import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { File } from 'expo-file-system';
import { AccountPicker, accountLabel } from '@/components/account-picker';
import { formatDay, formatWholeRupees as rupees } from '@/components/format';
import { Button, ErrorText, Field, colors, radius } from '@/components/ui';
import { listAccountBalances } from '@/lib/ledger';
import { PdfError, type PdfErrorCode } from '@/lib/pdf-service';
import { importStatement, previewStatement, readStatement, type StatementImportResult, type StatementPreview } from '@/lib/statements';

const ERRORS: Record<PdfErrorCode, string> = {
  wrong_password: "That password didn't open the PDF. Banks often use a mix of your name and date of birth; the email with the statement says which.",
  not_a_statement: "Couldn't find a transaction table in this PDF. ICICI statements work for now; other banks are coming.",
  not_a_cas: "Couldn't find a transaction table in this PDF.",
  demat_not_supported: "Couldn't find a transaction table in this PDF.",
  too_large: 'The PDF is over 10 MB. Download a shorter period.',
  not_configured: "The statement reader isn't set up on the server yet.",
  service_unavailable: "Couldn't reach the statement reader. Check your connection and try again; it can take a minute to wake up.",
  unknown: 'Something went wrong reading the statement. Try again in a minute.',
};

interface Target {
  id: string;
  label: string;
}

/** CAP-5: import a bank statement PDF, filling in payments the SMS missed without doubling the ones it caught. */
export default function StatementImport() {
  const params = useLocalSearchParams<{ account?: string }>();
  const [file, setFile] = useState<{ uri: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<StatementImportResult | null>(null);

  useEffect(() => {
    if (!params.account) return;
    listAccountBalances().then((all) => {
      const found = all.find((b) => b.account.id === params.account);
      if (found) setTarget({ id: found.account.id, label: accountLabel(found.account) });
    });
  }, [params.account]);

  async function pick() {
    setError(null);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/pdf'] });
      if (picked.canceled) return;
      setFile({ uri: picked.result.uri, name: picked.result.name });
      setPreview(null);
    } catch {
      setError("Couldn't open the file picker.");
    }
  }

  async function read() {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const next = await previewStatement(await readStatement(file, password));
      if (next.rows.length === 0) throw new PdfError('not_a_statement');
      setPreview(next);
      if (!target && next.suggested) setTarget({ id: next.suggested.account.id, label: accountLabel(next.suggested.account) });
    } catch (e) {
      setError(ERRORS[e instanceof PdfError ? e.code : 'unknown']);
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!preview || !target) return;
    setSaving(true);
    setError(null);
    try {
      setResult(await importStatement(preview.rows, target.id));
    } catch (e) {
      setError(`Couldn't import the statement: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.summary}>
          <Text style={styles.total}>{result.added === 0 ? 'Nothing was missing' : `${result.added} ${result.added === 1 ? 'payment' : 'payments'} added`}</Text>
          <Text style={styles.meta}>
            {result.matched} already in from SMS{result.transfers > 0 ? ` · ${result.transfers} transfers between your accounts` : ''}
            {result.skipped > 0 ? ` · ${result.skipped} imported before` : ''}
          </Text>
        </View>
        <Text style={styles.hint}>
          Payments the SMS missed are in Activity, categorised like the rest; anything the app wasn't sure of is waiting in Review. The statement's closing balance now checks the account's balance.
        </Text>
        <View style={styles.actions}>
          <Button title="Done" onPress={() => router.back()} />
        </View>
      </ScrollView>
    );
  }

  if (preview) {
    const from = preview.from ? formatDay(`${preview.from}T12:00:00`) : null;
    const to = preview.to ? formatDay(`${preview.to}T12:00:00`) : null;
    return (
      <>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.summary}>
            <Text style={styles.meta}>{from && to ? `${from} to ${to}` : 'Statement'}</Text>
            <Text style={styles.total}>{preview.rows.length} entries</Text>
            <Text style={styles.meta}>
              Out {rupees(preview.debits)} · In {rupees(preview.credits)}
            </Text>
          </View>
          <Text style={styles.label}>Account</Text>
          <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
            <Text style={[styles.pickerText, !target && styles.placeholder]} numberOfLines={1}>
              {target ? target.label : 'Which account is this statement for?'}
            </Text>
            <Feather name="chevron-down" size={18} color={colors.muted} />
          </Pressable>
          <Text style={styles.hint}>
            Entries the SMS already recorded are matched by their reference or by amount and date, so nothing is counted twice. Only the payments it missed are added.
          </Text>
          {error && <ErrorText>{error}</ErrorText>}
          <View style={styles.actions}>
            <Button title="Import" onPress={save} loading={saving} disabled={!target} />
            <Button title="Choose another statement" variant="secondary" onPress={() => setPreview(null)} disabled={saving} />
          </View>
        </ScrollView>
        <AccountPicker
          visible={picking}
          title="Statement for"
          onPick={(b) => {
            setTarget({ id: b.account.id, label: accountLabel(b.account) });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      </>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>
        A statement fills in what the SMS missed: payments from before you installed the app, or messages that never arrived. Download it as a PDF from your bank's app or net banking. ICICI statements work now; HDFC, HSBC and SBI follow.
      </Text>

      <Text style={styles.label}>Statement</Text>
      <Pressable accessibilityRole="button" onPress={pick} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
        <Feather name="file-text" size={18} color={colors.muted} />
        <Text style={[styles.pickerText, !file && styles.placeholder]} numberOfLines={1}>
          {file ? file.name : 'Choose the PDF'}
        </Text>
      </Pressable>
      <Field label="PDF password (if it has one)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.hint}>The PDF goes to the statement reader only to read it, and isn't kept anywhere. Your name and address never reach the app.</Text>
      {reading && <Text style={styles.hint}>Reading the statement. The first one in a while can take up to a minute.</Text>}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Read statement" onPress={read} loading={reading} disabled={!file} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 4 },
  intro: { fontSize: 15, color: colors.text, lineHeight: 22 },
  label: { fontSize: 14, color: colors.muted, marginTop: 12, marginBottom: 6 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.pressed },
  pickerText: { flex: 1, fontSize: 16, color: colors.text },
  placeholder: { color: colors.muted },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 8 },
  summary: { padding: 16, borderRadius: 20, backgroundColor: colors.subtle, gap: 4, marginBottom: 8 },
  total: { fontSize: 24, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  actions: { marginTop: 20, gap: 10 },
});
