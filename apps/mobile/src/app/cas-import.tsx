import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { File } from 'expo-file-system';
import { dematGroups, paise, type CasStatement, type DematGroup, type DematStatement } from '@money-plant/core';
import { FormScroll } from '@/components/keyboard';
import { formatDay, formatWholeRupees as rupees } from '@/components/format';
import { Button, Card, ErrorText, Field, colors, radius } from '@/components/ui';
import { casHoldings, importCas, readCas, shortSchemeName, type CasHolding } from '@/lib/funds';
import { heldFundIsins, importDemat } from '@/lib/demat';
import { PdfError, type PdfErrorCode } from '@/lib/pdf-service';

const KFINTECH_CAS_URL = 'https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement';

const ERRORS: Record<PdfErrorCode, string> = {
  wrong_password: "That password didn't open the PDF. It's the one you chose when you asked for the statement.",
  not_a_cas: "This doesn't look like a CAS. Use the detailed statement from KFinTech or CAMS, or the monthly one from NSDL or CDSL.",
  not_a_statement: "This doesn't look like a CAS from CAMS or KFintech.",
  demat_not_supported: "This statement couldn't be read.",
  too_large: 'The PDF is over 10 MB.',
  not_configured: "The statement reader isn't set up on the server yet.",
  service_unavailable: "Couldn't reach the statement reader. Check your connection and try again; it can take a minute to wake up.",
  unknown: "Something went wrong reading the statement. Try again in a minute.",
};

const KIND_LABEL: Record<string, string> = { share: 'Share', etf: 'ETF', gold_bond: 'Gold bond', bond: 'Bond', fund: 'Mutual fund', nps: 'NPS' };

/**
 * NW-3: import mutual fund holdings from a CAS PDF, matching past SIPs to bank debits already in the ledger.
 * NW-5, NW-6: or shares, ETFs, gold bonds, bonds and NPS from an NSDL or CDSL statement.
 */
export default function CasImport() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statement, setStatement] = useState<CasStatement | DematStatement | null>(null);
  const [demat, setDemat] = useState<DematGroup[] | null>(null);
  const funds: CasHolding[] = statement && statement.kind !== 'demat' ? casHoldings(statement) : [];

  async function pick() {
    setError(null);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ['application/pdf'] });
      if (picked.canceled) return;
      setFile(picked.result);
      setStatement(null);
    } catch {
      setError("Couldn't open the file picker.");
    }
  }

  async function read() {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const read = await readCas(file, password);
      setDemat(read.kind === 'demat' ? dematGroups(read, await heldFundIsins()) : null);
      setStatement(read);
    } catch (e) {
      setError(e instanceof PdfError ? `${ERRORS[e.code]}${e.detail ? ` (${e.detail})` : ''}` : `${ERRORS.unknown} (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!statement) return;
    setSaving(true);
    try {
      if (statement.kind === 'demat') await importDemat(statement);
      else await importCas(statement);
      router.back();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  if (statement && statement.kind === 'demat' && demat) {
    const items = demat.flatMap((g) => g.items);
    const value = items.reduce((sum, item) => sum + item.value, 0);
    const end = demat[0]?.asOf;
    return (
      <FormScroll contentContainerStyle={styles.container}>
        <View style={styles.summary}>
          <Text style={styles.meta}>{end ? `Worth on ${formatDay(`${end}T12:00:00`)}` : 'Worth'}</Text>
          <Text style={styles.total}>{rupees(paise(value))}</Text>
          <Text style={styles.meta}>
            {items.length} {items.length === 1 ? 'holding' : 'holdings'} in {demat.length} {demat.length === 1 ? 'account' : 'accounts'}
          </Text>
        </View>
        {demat.length === 0 ? (
          <Text style={styles.hint}>Nothing with units left in this statement, other than funds you already imported.</Text>
        ) : (
          demat.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.label}>
                {group.name}
                {group.last4 ? ` ••${group.last4}` : ''}
              </Text>
              <Card>
                {group.items.map((item, i) => (
                  <View key={item.key} style={[styles.row, i > 0 && styles.divided]}>
                    <View style={styles.grow}>
                      <Text style={styles.name} numberOfLines={2}>
                        {item.symbol ?? item.name}
                      </Text>
                      <Text style={styles.meta}>
                        {KIND_LABEL[item.kind]} · {(item.unitsE4 / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 4 })} units
                      </Text>
                    </View>
                    <Text style={styles.amount}>{rupees(item.value)}</Text>
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
        <Text style={styles.hint}>
          Each demat account becomes one account worth its holdings at the latest closing prices, and NPS at the latest NAV, updated through the day.
          Money you send to a known broker counts as investing, not spending. The statement has no purchase prices for shares, so add what you paid on
          each holding to see your gain. Import a newer statement any time to update the units.
        </Text>
        {statement.warnings.length > 0 && <Text style={styles.hint}>Some lines of the statement couldn't be read, so check the totals against it.</Text>}
        {error && <ErrorText>{error}</ErrorText>}
        <View style={styles.actions}>
          <Button title={demat.length === 1 ? 'Add the account' : `Add ${demat.length} accounts`} onPress={save} loading={saving} disabled={demat.length === 0} />
          <Button title="Choose another statement" variant="secondary" onPress={() => setStatement(null)} disabled={saving} />
        </View>
      </FormScroll>
    );
  }

  if (statement && statement.kind !== 'demat') {
    const value = funds.reduce((sum, f) => sum + f.value, 0);
    const cost = funds.reduce((sum, f) => sum + f.cost, 0);
    const payments = funds.reduce((sum, f) => sum + f.flows.length, 0);
    const end = funds[0]?.asOf;
    return (
      <FormScroll contentContainerStyle={styles.container}>
        <View style={styles.summary}>
          <Text style={styles.meta}>{end ? `Worth on ${formatDay(`${end}T12:00:00`)}` : 'Worth'}</Text>
          <Text style={styles.total}>{rupees(paise(value))}</Text>
          <Text style={styles.meta}>
            Invested {rupees(paise(cost))} · {funds.length} {funds.length === 1 ? 'fund' : 'funds'}
          </Text>
        </View>
        {funds.length === 0 ? (
          <Text style={styles.hint}>No funds with units left in this statement.</Text>
        ) : (
          <Card>
            {funds.map((f, i) => (
              <View key={f.key} style={[styles.row, i > 0 && styles.divided]}>
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={2}>
                    {shortSchemeName(f.scheme)}
                  </Text>
                  <Text style={styles.meta}>
                    {f.amc ?? 'Mutual fund'}
                    {f.sip ? ` · SIP ${rupees(f.sip.amount)}` : ''}
                  </Text>
                </View>
                <Text style={styles.amount}>{rupees(f.value)}</Text>
              </View>
            ))}
          </Card>
        )}
        <Text style={styles.hint}>
          Each fund becomes an account worth its units at the latest NAV, updated daily. {payments > 0 ? 'Purchases and SIPs in the statement are matched to your bank debits, so they count as investing, not spending. ' : ''}
          Import a newer CAS any time to update the units.
        </Text>
        {statement.warnings.length > 0 && <Text style={styles.hint}>Some lines of the statement couldn't be read, so check the totals against it.</Text>}
        {error && <ErrorText>{error}</ErrorText>}
        <View style={styles.actions}>
          <Button title={funds.length === 1 ? 'Add the fund' : `Add ${funds.length} funds`} onPress={save} loading={saving} disabled={funds.length === 0} />
          <Button title="Choose another statement" variant="secondary" onPress={() => setStatement(null)} disabled={saving} />
        </View>
      </FormScroll>
    );
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.intro}>
        A Consolidated Account Statement (CAS) lists every mutual fund you hold, across all apps and fund houses. Ask KFinTech for the detailed statement for all folios (CAMS sends the same one); it arrives by email as a PDF with the password you choose.
      </Text>
      <Text style={styles.intro}>
        For shares, ETFs, gold bonds and NPS, use the CAS that NSDL or CDSL emails you each month. Its password is usually your PAN in capitals.
      </Text>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(KFINTECH_CAS_URL)} style={styles.link}>
        <Feather name="external-link" size={14} color={colors.primary} />
        <Text style={styles.linkText}>Ask KFinTech for a CAS</Text>
      </Pressable>

      <Text style={styles.label}>Statement</Text>
      <Pressable accessibilityRole="button" onPress={pick} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
        <Feather name="file-text" size={18} color={colors.muted} />
        <Text style={[styles.pickerText, !file && styles.placeholder]} numberOfLines={1}>
          {file ? file.name : 'Choose the PDF'}
        </Text>
      </Pressable>
      <Field label="PDF password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.hint}>The PDF and password go to the statement reader only to read it, and aren't kept anywhere.</Text>
      {reading && <Text style={styles.hint}>Reading the statement. The first one in a while can take up to a minute.</Text>}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Read statement" onPress={read} loading={reading} disabled={!file || password === ''} />
      </View>
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 4 },
  intro: { fontSize: 15, color: colors.text, lineHeight: 22 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  linkText: { fontSize: 15, fontWeight: '600', color: colors.primary },
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
  total: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { marginTop: 20, gap: 10 },
  group: { gap: 2 },
});
