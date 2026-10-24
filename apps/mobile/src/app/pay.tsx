import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Feather from '@expo/vector-icons/Feather';
import { formatRupees, parseRupees, parseUpiUri, type UpiPayment, type UpiStatus } from '@money-plant/core';
import { CategoryPicker } from '@/components/category-picker';
import { formatAmount } from '@/components/format';
import { Button, Chip, Chips, ErrorText, Field, Initial, colors, radius } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { isShop, lastChoiceFor, lastUpiApp, payWithUpi, settleUnconfirmed, UPI_APPS, type PaymentResult } from '@/lib/upi';

const CHOOSER = 'chooser';

/**
 * PAY-1, PAY-2: scan a UPI QR, confirm the amount, category and account, then
 * hand the payment to the user's own UPI app. The entry is logged first and
 * confirmed by the app's answer, the user, or the bank SMS.
 */
export default function ScanAndPay() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [typed, setTyped] = useState('');
  const [payment, setPayment] = useState<UpiPayment | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [app, setApp] = useState<string>(CHOOSER);
  const [picking, setPicking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The camera reports the same code several times before it closes.
  const handled = useRef(false);

  useEffect(() => {
    listAccountBalances().then((all) => setAccounts(all.filter((b) => !b.liability || b.account.type === 'credit_card')));
    categoryNames().then(setNames);
    lastUpiApp().then((pkg) => pkg && setApp(pkg));
  }, []);

  useEffect(() => {
    if (scanning && permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [scanning, permission, requestPermission]);

  async function choose(parsed: UpiPayment) {
    setPayment(parsed);
    setScanning(false);
    setError(null);
    if (parsed.amount) setAmount(formatRupees(parsed.amount, { symbol: false }).replace(/,/g, ''));
    const last = await lastChoiceFor(parsed.payeeVpa);
    setCategoryId(last.categoryId);
    setAccountId(last.accountId);
  }

  function onScanned(data: string) {
    if (handled.current) return;
    handled.current = true;
    const parsed = parseUpiUri(data);
    if (!parsed) {
      setError("That QR code isn't a UPI payment code.");
      setTimeout(() => (handled.current = false), 1500);
      return;
    }
    choose(parsed);
  }

  function useTyped() {
    const parsed = parseUpiUri(`upi://pay?pa=${encodeURIComponent(typed.trim())}`);
    if (!parsed) return setError('Enter a UPI ID like name@okaxis');
    choose(parsed);
  }

  async function pay() {
    if (!payment) return;
    const parsed = parseRupees(amount);
    if (parsed === null || parsed <= 0) return setError('Enter the amount as a number above zero');
    if (!categoryId) return setError('Pick a category');
    if (!accountId) return setError('Pick the account you will pay from');
    setPaying(true);
    setError(null);
    try {
      setResult(await payWithUpi({ payment, amount: parsed, categoryId, accountId, note, appPackage: app === CHOOSER ? null : app }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaying(false);
    }
  }

  async function answer(wentThrough: boolean) {
    if (!result) return;
    await settleUnconfirmed(result.transactionId, wentThrough);
    setAnswered(wentThrough);
    if (!wentThrough) router.back();
  }

  if (Platform.OS !== 'android') {
    return (
      <View style={styles.container}>
        <Text style={styles.meta}>Scan and pay works on Android for now.</Text>
      </View>
    );
  }

  if (result) {
    return <Done result={result} answered={answered} payment={payment!} onAnswer={answer} />;
  }

  if (scanning) {
    return (
      <View style={styles.scanner}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => onScanned(r.data)} />
        ) : (
          <View style={styles.noCamera}>
            <Text style={styles.meta}>Money Plant needs the camera to scan a UPI QR code.</Text>
            <Button title="Allow camera" onPress={requestPermission} />
          </View>
        )}
        <View style={styles.scanFooter}>
          {error && <Text style={styles.scanError}>{error}</Text>}
          <Field label="Or type a UPI ID" value={typed} onChangeText={setTyped} autoCapitalize="none" placeholder="name@okaxis" />
          <Button title="Continue" variant="secondary" onPress={useTyped} disabled={!typed.trim()} />
        </View>
      </View>
    );
  }

  const fixedAmount = payment?.amount !== undefined;
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {payment && (
        <View style={styles.payee}>
          <Initial name={payment.payeeName ?? payment.payeeVpa} size={48} />
          <View style={styles.grow}>
            <Text style={styles.name}>{payment.payeeName ?? payment.payeeVpa}</Text>
            <Text style={styles.meta}>
              {payment.payeeVpa} · {isShop(payment) ? 'shop' : 'person'}
            </Text>
          </View>
        </View>
      )}
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!fixedAmount} autoFocus={!fixedAmount} />
      {fixedAmount && <Text style={styles.hint}>The QR code sets this amount.</Text>}
      <Text style={styles.label}>Category</Text>
      <Chips>
        <Chip label={categoryId ? (names.get(categoryId) ?? 'Category') : 'Pick a category'} selected={categoryId !== null} onPress={() => setPicking(true)} />
      </Chips>
      <Text style={styles.label}>Paying from</Text>
      <Chips>
        {accounts.map((b) => (
          <Chip key={b.account.id} label={b.account.name} selected={accountId === b.account.id} onPress={() => setAccountId(b.account.id)} />
        ))}
      </Chips>
      <Text style={styles.hint}>If you pick another account in the UPI app, the bank SMS fixes it.</Text>
      <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={50} />
      <Text style={styles.label}>Pay with</Text>
      <Chips>
        {UPI_APPS.map((a) => (
          <Chip key={a.pkg} label={a.name} selected={app === a.pkg} onPress={() => setApp(a.pkg)} />
        ))}
        <Chip label="Ask each time" selected={app === CHOOSER} onPress={() => setApp(CHOOSER)} />
      </Chips>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={`Pay ${parseRupees(amount) ? formatAmount(parseRupees(amount)!) : ''}`.trim()} onPress={pay} loading={paying} />
        <Text style={styles.hint}>Your UPI app asks for your PIN. Money Plant never moves money itself.</Text>
      </View>
      <CategoryPicker
        visible={picking}
        flow="expense"
        onPick={(category) => {
          setCategoryId(category.id);
          setNames(new Map(names).set(category.id, category.name));
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

const MESSAGES: Record<UpiStatus, string> = {
  success: 'Paid',
  submitted: 'Payment is processing',
  failure: "The payment didn't go through",
  unknown: 'Did the payment go through?',
};

function Done({ result, answered, payment, onAnswer }: { result: PaymentResult; answered: boolean | null; payment: UpiPayment; onAnswer: (yes: boolean) => void }) {
  const unsure = (result.status === 'unknown' || result.status === 'submitted') && answered === null;
  const paid = result.status === 'success' || answered === true;
  return (
    <ScrollView contentContainerStyle={[styles.container, styles.done]}>
      <View style={[styles.doneIcon, !paid && !unsure && styles.doneIconFailed]}>
        <Feather name={paid ? 'check' : unsure ? 'help-circle' : 'x'} size={30} color={paid ? colors.primary : unsure ? colors.warning : colors.danger} />
      </View>
      <Text style={styles.doneTitle}>{answered === true ? 'Paid' : MESSAGES[result.status]}</Text>
      {unsure && (
        <>
          <Text style={styles.doneText}>Your UPI app didn't say. If you're not sure, leave it: the bank SMS confirms it, or it waits in Review.</Text>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button title="Yes, it went through" onPress={() => onAnswer(true)} />
            </View>
            <View style={styles.grow}>
              <Button title="No" variant="secondary" onPress={() => onAnswer(false)} />
            </View>
          </View>
        </>
      )}
      {result.status === 'failure' && <Text style={styles.doneText}>Nothing was logged. Try again or use another app.</Text>}
      {(paid || unsure) && (
        <View style={styles.actions}>
          <Button title="Split it with people" variant="secondary" onPress={() => router.replace(`/split/${result.transactionId}`)} />
          {!isShop(payment) && <Button title="I lent this to them" variant="secondary" onPress={() => router.replace(`/iou/new?from=${result.transactionId}`)} />}
          <Button title="Done" onPress={() => router.back()} />
        </View>
      )}
      {result.status === 'failure' && <Button title="Close" onPress={() => router.back()} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  scanner: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.background },
  noCamera: { flex: 1, justifyContent: 'center', padding: 20, gap: 16 },
  scanFooter: { padding: 20, gap: 10, backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  scanError: { fontSize: 14, color: colors.danger },
  payee: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  actions: { marginTop: 24, gap: 10, alignSelf: 'stretch' },
  done: { alignItems: 'center', paddingTop: 64, gap: 12 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  doneIconFailed: { backgroundColor: colors.warningSurface },
  doneTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  doneText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 8 },
});
