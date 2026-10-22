import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  buildUpiUri,
  formatRupees,
  parseRupees,
  parseUpiResponse,
  parseUpiUri,
  type UpiPayment,
} from '@money-plant/core';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { kvGet, kvSet } from '@/lib/kv';

/**
 * Temporary test screen for the UPI hand-off (PAY-1, IOU-3; decision 0003).
 * It opens each UPI app with a scanned or typed payee and records what the app
 * returns, so we learn which apps accept payments started from another app.
 * It creates no ledger entries.
 */

const UPI_APPS = [
  { name: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user' },
  { name: 'PhonePe', pkg: 'com.phonepe.app' },
  { name: 'iMobile (ICICI)', pkg: 'com.csam.icici.bank.imobile' },
  { name: 'HDFC Bank', pkg: 'com.snapwork.hdfc' },
  { name: 'YONO SBI', pkg: 'com.sbi.lotusintouch' },
  { name: 'HSBC India', pkg: 'com.hsbc.hsbcindia' },
  { name: 'slice', pkg: 'indwin.c3.shareapp' },
  { name: 'Paytm', pkg: 'net.one97.paytm' },
  { name: 'BHIM', pkg: 'in.org.npci.upiapp' },
];

const RESULTS_KEY = 'upi_test_results';

interface TestResult {
  at: string;
  app: string;
  payeeKind: 'shop' | 'person';
  withReference: boolean;
  resultCode: number | null;
  status: string;
  responseCode?: string;
  /** What the app sent back, minus ids, so the summary can be shared. */
  responseKeys: string[];
  error?: string;
}

function payeeKind(payment: UpiPayment): TestResult['payeeKind'] {
  return payment.merchantCode && payment.merchantCode !== '0000' ? 'shop' : 'person';
}

/** UPI apps put their response in different places: an extra named "response", other extras, or the data URI. */
function responseText(result: IntentLauncher.IntentLauncherResult): string | undefined {
  const extra = (result.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.response === 'string') return extra.response;
  const pairs = Object.entries(extra)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => `${key}=${value as string}`);
  if (pairs.length > 0) return pairs.join('&');
  return result.data ?? undefined;
}

export default function UpiTest() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [payment, setPayment] = useState<UpiPayment | null>(null);
  const [vpa, setVpa] = useState('');
  const [amountText, setAmountText] = useState('1');
  const [withReference, setWithReference] = useState(true);
  const [customPkg, setCustomPkg] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The camera reports the same code several times before the scanner closes.
  const handledScan = useRef(false);

  useEffect(() => {
    kvGet(RESULTS_KEY).then((value) => value && setResults(JSON.parse(value) as TestResult[]));
  }, []);

  if (Platform.OS !== 'android') {
    return (
      <View style={styles.container}>
        <Text style={styles.body}>The UPI hand-off test runs on Android only.</Text>
      </View>
    );
  }

  async function startScan() {
    if (!permission?.granted && !(await requestPermission()).granted) {
      setError('Money Plant needs the camera to scan a QR code.');
      return;
    }
    setError(null);
    handledScan.current = false;
    setScanning(true);
  }

  function onScanned(data: string) {
    if (handledScan.current) return;
    handledScan.current = true;
    const parsed = parseUpiUri(data);
    setScanning(false);
    if (!parsed) {
      setError("That QR code isn't a UPI payment code.");
      return;
    }
    setError(null);
    setPayment(parsed);
    if (parsed.amount) setAmountText(formatRupees(parsed.amount, { symbol: false }).replace(/,/g, ''));
  }

  function applyTypedVpa() {
    const parsed = parseUpiUri(`upi://pay?pa=${encodeURIComponent(vpa.trim())}`);
    if (!parsed) {
      setError('Enter a UPI ID like name@okaxis.');
      return;
    }
    setError(null);
    setPayment(parsed);
  }

  async function record(result: TestResult) {
    const next = [result, ...results];
    setResults(next);
    await kvSet(RESULTS_KEY, JSON.stringify(next));
  }

  async function pay(app: { name: string; pkg?: string }) {
    if (!payment) return;
    const amount = parseRupees(amountText);
    if (amount === null || amount <= 0) {
      setError('Enter an amount, for example 1.');
      return;
    }
    setError(null);
    const uri = buildUpiUri(payment, {
      amount,
      reference: withReference ? `MPT${Date.now()}` : undefined,
      note: 'Money Plant test',
    });
    const base = { at: new Date().toISOString(), app: app.name, payeeKind: payeeKind(payment), withReference };
    try {
      const result = await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: uri,
        packageName: app.pkg,
      });
      const response = parseUpiResponse(responseText(result));
      await record({
        ...base,
        resultCode: result.resultCode,
        status: response.status,
        responseCode: response.responseCode,
        responseKeys: Object.keys(response.fields),
      });
    } catch (e) {
      await record({
        ...base,
        resultCode: null,
        status: 'not opened',
        responseKeys: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function markOutcome(index: number, outcome: string) {
    const next = results.map((r, i) => (i === index ? { ...r, status: `${r.status}; user says ${outcome}` } : r));
    setResults(next);
    await kvSet(RESULTS_KEY, JSON.stringify(next));
  }

  async function shareResults() {
    // Leaves out UPI IDs and transaction ids, so the summary is safe to paste into a chat.
    const lines = results.map(
      (r) =>
        `${r.at} | ${r.app} | ${r.payeeKind} | ref ${r.withReference ? 'on' : 'off'} | result ${r.resultCode ?? '-'} | ${r.status}` +
        `${r.responseCode ? ` | code ${r.responseCode}` : ''}${r.responseKeys.length ? ` | keys ${r.responseKeys.join(',')}` : ''}` +
        `${r.error ? ` | error ${r.error}` : ''}`,
    );
    await Share.share({ message: ['Money Plant UPI hand-off test', ...lines].join('\n') });
  }

  async function clearResults() {
    setResults([]);
    await kvSet(RESULTS_KEY, '[]');
  }

  if (scanning) {
    return (
      <View style={styles.scanner}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => onScanned(result.data)}
        />
        <View style={styles.scanFooter}>
          <Button title="Cancel" variant="secondary" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        Test whether each UPI app accepts a payment that Money Plant hands to it. Try a shop QR and a friend's UPI ID with
        ₹1 in each app, approve or cancel inside the app, then share the results.
      </Text>

      <Text style={styles.heading}>1. Payee</Text>
      <Button title="Scan a UPI QR" onPress={startScan} />
      <Field label="Or type a UPI ID" value={vpa} onChangeText={setVpa} autoCapitalize="none" placeholder="name@okaxis" />
      <View style={styles.spaced}>
        <Button title="Use this UPI ID" variant="secondary" onPress={applyTypedVpa} disabled={!vpa.trim()} />
      </View>
      {payment && (
        <View style={styles.card}>
          <Text style={styles.name}>{payment.payeeName ?? payment.payeeVpa}</Text>
          <Text style={styles.meta}>
            {payment.payeeVpa} · {payeeKind(payment) === 'shop' ? `shop (code ${payment.merchantCode})` : 'person'}
          </Text>
        </View>
      )}

      <Text style={styles.heading}>2. Amount and options</Text>
      <Field label="Amount in rupees" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" />
      <View style={styles.toggle}>
        <Text style={styles.toggleLabel}>Send our own reference (tr)</Text>
        <Switch value={withReference} onValueChange={setWithReference} />
      </View>

      <Text style={styles.heading}>3. Pay with</Text>
      <View style={styles.apps}>
        {UPI_APPS.map((app) => (
          <View key={app.pkg} style={styles.app}>
            <Button title={app.name} variant="secondary" onPress={() => pay(app)} disabled={!payment} />
          </View>
        ))}
      </View>
      <View style={styles.spaced}>
        <Button title="Let Android choose" variant="secondary" onPress={() => pay({ name: 'Android chooser' })} disabled={!payment} />
      </View>
      <Field label="Other app's package name" value={customPkg} onChangeText={setCustomPkg} autoCapitalize="none" />
      <View style={styles.spaced}>
        <Button
          title="Pay with that package"
          variant="secondary"
          onPress={() => pay({ name: customPkg.trim(), pkg: customPkg.trim() })}
          disabled={!payment || !customPkg.trim()}
        />
      </View>
      {error && <ErrorText>{error}</ErrorText>}

      <Text style={styles.heading}>Results</Text>
      {results.length === 0 && <Text style={styles.meta}>No attempts yet.</Text>}
      {results.map((r, index) => (
        <View key={`${r.at}-${index}`} style={styles.card}>
          <Text style={styles.name}>
            {r.app} · {r.payeeKind}
          </Text>
          <Text style={styles.meta}>
            {formatDateTime(r.at)} · result {r.resultCode ?? '-'} · {r.status}
            {r.responseCode ? ` · code ${r.responseCode}` : ''}
          </Text>
          {r.error && <Text style={styles.meta}>{r.error}</Text>}
          {!r.status.includes('user says') && (
            <View style={styles.outcomes}>
              {['paid', 'declined', 'cancelled'].map((outcome) => (
                <Pressable key={outcome} onPress={() => markOutcome(index, outcome)} hitSlop={8}>
                  <Text style={styles.outcome}>{outcome}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
      {results.length > 0 && (
        <View style={styles.links}>
          <View style={styles.link}>
            <Button title="Share results" onPress={shareResults} />
          </View>
          <View style={styles.link}>
            <Button title="Clear" variant="secondary" onPress={clearResults} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 4 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  heading: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 24, marginBottom: 8 },
  spaced: { marginTop: 8 },
  card: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  toggleLabel: { fontSize: 15, color: colors.text },
  apps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  app: { width: '48%' },
  outcomes: { flexDirection: 'row', gap: 20, marginTop: 8 },
  outcome: { color: colors.primary, fontSize: 15 },
  links: { flexDirection: 'row', gap: 8, marginTop: 12 },
  link: { flex: 1 },
  scanner: { flex: 1, justifyContent: 'flex-end' },
  scanFooter: { padding: 16 },
});
