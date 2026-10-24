import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Feather from '@expo/vector-icons/Feather';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseRupees, parseUpiUri, type Paise, type UpiPayment, type UpiStatus } from '@money-plant/core';
import { accountLabel } from '@/components/account-picker';
import { CategoryPicker } from '@/components/category-picker';
import { formatAmount, formatTime } from '@/components/format';
import { CategoryIcon } from '@/components/sheet';
import { Button, ErrorText, Initial, colors, radius } from '@/components/ui';
import { categoryNames, flatten, listCategories } from '@/lib/categories';
import { editEntry, setCategoryForEntries } from '@/lib/entries';
import { listAccountBalances } from '@/lib/ledger';
import { guessForPayee, isShop, payWithUpi, recentPayees, settleUnconfirmed, type PayeeGuess, type PaymentResult } from '@/lib/upi';

/** UPI's per-payment ceiling for most payments, ₹1,00,000. */
const MAX_AMOUNT = 10_000_000;

/**
 * PAY-1, PAY-2: pay first, details after. Scan a UPI QR (or pick a photo of
 * one, or type a UPI ID), enter the amount, and hand the payment to the UPI
 * app Android picks. The entry is logged before the app opens and confirmed
 * by the app's answer, the user, or the bank SMS. The Paid sheet then asks
 * what it was for.
 */
export default function ScanAndPay() {
  const [payment, setPayment] = useState<UpiPayment | null>(null);
  const [guess, setGuess] = useState<PayeeGuess | null>(null);
  const [result, setResult] = useState<{ payment: PaymentResult; amount: Paise; at: string } | null>(null);

  async function choose(parsed: UpiPayment) {
    setPayment(parsed);
    setGuess(await guessForPayee(parsed, parsed.amount ?? null));
  }

  if (Platform.OS !== 'android') {
    return (
      <View style={styles.center}>
        <Text style={styles.meta}>Scan and pay works on Android for now.</Text>
      </View>
    );
  }
  return (
    <>
      {!payment ? (
        <Scan onPayee={choose} />
      ) : !result ? (
        <Amount
          payment={payment}
          guess={guess}
          onBack={() => {
            setPayment(null);
            setGuess(null);
          }}
          onPaid={(paid, amount) => setResult({ payment: paid, amount, at: new Date().toISOString() })}
        />
      ) : (
        <Paid payment={payment} guess={guess} result={result.payment} amount={result.amount} at={result.at} onRetry={() => setResult(null)} />
      )}
    </>
  );
}

function Scan({ onPayee }: { onPayee: (payment: UpiPayment) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [typed, setTyped] = useState('');
  const [recent, setRecent] = useState<UpiPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = Math.min(270, width - 120);
  // The camera reports the same code several times before the screen changes.
  const handled = useRef(false);

  useEffect(() => {
    recentPayees().then(setRecent, () => setRecent([]));
  }, []);
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  function read(data: string): boolean {
    const parsed = parseUpiUri(data);
    if (!parsed) return false;
    onPayee(parsed);
    return true;
  }

  function onScanned(data: string) {
    if (handled.current) return;
    handled.current = true;
    if (read(data)) return;
    setError("That QR code isn't a UPI payment code.");
    setTimeout(() => (handled.current = false), 1500);
  }

  async function fromGallery() {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    try {
      const codes = await scanFromURLAsync(picked.assets[0].uri, ['qr']);
      if (!codes.some((code) => read(code.data))) setError(codes.length ? "That QR code isn't a UPI payment code." : 'No QR code found in that photo. Crop it close to the code and try again.');
    } catch {
      setError("Couldn't read that photo.");
    }
  }

  function useTyped() {
    const vpa = typed.trim();
    if (!/^[\w.-]+@[\w.-]+$/.test(vpa) || !read(`upi://pay?pa=${encodeURIComponent(vpa)}`)) setError('Enter a UPI ID like name@okaxis');
  }

  return (
    <View style={styles.scan}>
      <View style={[styles.scanHead, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => router.back()} style={styles.iconButton}>
          <Feather name="x" size={22} color={SCAN_TEXT} />
        </Pressable>
        <Text style={styles.scanTitle}>Scan any UPI QR</Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Torch"
          accessibilityState={{ checked: torch }}
          hitSlop={8}
          onPress={() => setTorch(!torch)}
          style={styles.iconButton}
        >
          <Feather name={torch ? 'zap-off' : 'zap'} size={20} color={torch ? colors.primary : SCAN_TEXT} />
        </Pressable>
      </View>

      <View style={styles.scanBody}>
        <View style={[styles.frame, { width: size, height: size }]}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => onScanned(r.data)}
            />
          ) : (
            <Pressable accessibilityRole="button" onPress={requestPermission} style={styles.noCamera}>
              <Feather name="camera" size={24} color={SCAN_MUTED} />
              <Text style={styles.scanHint}>Allow the camera to scan</Text>
            </Pressable>
          )}
          <Corners />
          {permission?.granted && <ScanLine size={size} />}
        </View>
        <Text style={styles.scanHint}>{error ?? 'Point at the QR code.'}</Text>
        <Pressable accessibilityRole="button" onPress={fromGallery} style={({ pressed }) => [styles.gallery, pressed && styles.pressed]}>
          <Feather name="image" size={16} color={SCAN_TEXT} />
          <Text style={styles.galleryText}>Scan from gallery</Text>
        </Pressable>
      </View>

      <View style={[styles.without, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.withoutTitle}>Or pay without scanning</Text>
        <View style={styles.vpa}>
          <Feather name="at-sign" size={18} color={colors.muted} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="UPI ID, like name@okaxis"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={useTyped}
            accessibilityLabel="UPI ID"
            style={styles.vpaInput}
          />
          {typed.trim() !== '' && (
            <Pressable accessibilityRole="button" accessibilityLabel="Continue" hitSlop={8} onPress={useTyped}>
              <Feather name="arrow-right" size={20} color={colors.primary} />
            </Pressable>
          )}
        </View>
        {recent.length > 0 && (
          <View style={styles.recent}>
            {recent.map((p) => (
              <Pressable key={p.payeeVpa} accessibilityRole="button" accessibilityLabel={`Pay ${p.payeeName ?? p.payeeVpa}`} onPress={() => onPayee(p)} style={styles.recentItem}>
                <Initial name={p.payeeName ?? p.payeeVpa} size={44} />
                <Text style={styles.recentName} numberOfLines={1}>
                  {(p.payeeName ?? p.payeeVpa).split(' ')[0]}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** The scanner is always dark, whatever the app's theme. */
const SCAN_BG = '#0A0C0B';
const SCAN_TEXT = '#ECEFED';
const SCAN_MUTED = '#9AA39E';
const SCAN_GREEN = '#3DBE8B';

function Corners() {
  return (
    <>
      <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 }]} />
      <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 }]} />
      <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 }]} />
      <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 }]} />
    </>
  );
}

function ScanLine({ size }: { size: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [progress]);
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: 24 + progress.value * (size - 48) }] }));
  return <Animated.View pointerEvents="none" style={[styles.line, line]} />;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

function Amount(props: { payment: UpiPayment; guess: PayeeGuess | null; onBack: () => void; onPaid: (result: PaymentResult, amount: Paise) => void }) {
  const { payment, guess } = props;
  const fixed = payment.amount !== undefined;
  const [text, setText] = useState(fixed ? String(payment.amount! / 100) : '');
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);
  const [from, setFrom] = useState<{ id: string; label: string } | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const name = payment.payeeName ?? payment.payeeVpa;
  const amount = fixed ? payment.amount! : parseRupees(text || '0');

  useEffect(() => {
    listAccountBalances().then((all) => {
      const usable = all.filter((b) => !b.liability || b.account.type === 'credit_card');
      const pick = usable.find((b) => b.account.id === guess?.accountId) ?? usable.find((b) => b.account.type === 'bank') ?? usable[0];
      setFrom(pick ? { id: pick.account.id, label: accountLabel(pick.account) } : null);
    });
  }, [guess?.accountId]);

  function press(key: (typeof KEYS)[number]) {
    setError(null);
    if (key === 'back') return setText(text.slice(0, -1));
    if (key === '.' && (text.includes('.') || text === '')) return setText(text === '' ? '0.' : text);
    const next = text === '0' && key !== '.' ? key : text + key;
    const decimals = next.split('.')[1];
    if (decimals && decimals.length > 2) return;
    const value = parseRupees(next);
    if (value !== null && value > MAX_AMOUNT) return;
    setText(next);
  }

  async function pay() {
    if (amount === null || amount <= 0) return setError('Enter the amount');
    if (!from) return setError('Add a bank account first, so the payment has somewhere to come from');
    setPaying(true);
    setError(null);
    try {
      props.onPaid(await payWithUpi({ payment, amount, decision: guess?.decision ?? null, accountId: from.id, note }), amount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaying(false);
    }
  }

  const shown = fixed ? formatAmount(payment.amount!).replace(/\.00$/, '') : `₹${text === '' ? '0' : Number(text.split('.')[0]).toLocaleString('en-IN')}${text.includes('.') ? `.${text.split('.')[1]}` : ''}`;
  return (
    <View style={[styles.amountScreen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={props.onBack} style={styles.iconButton}>
        <Feather name="arrow-left" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.payee}>
        <Initial name={name} size={56} />
        <Text style={styles.paying}>Paying {name}</Text>
        <Text style={styles.meta}>{payment.payeeVpa}</Text>
      </View>
      <View style={styles.amountBox}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Amount ${shown}`}>
          {shown}
        </Text>
        {fixed && <Text style={styles.meta}>The QR code sets this amount</Text>}
        {noting ? (
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What's it for?"
            placeholderTextColor={colors.placeholder}
            maxLength={50}
            autoFocus
            onBlur={() => note.trim() === '' && setNoting(false)}
            style={styles.noteInput}
          />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setNoting(true)} style={styles.notePill}>
            <Text style={styles.noteText}>{note || 'Add a note'}</Text>
          </Pressable>
        )}
        <Text style={styles.small}>The note goes to your UPI app with the amount</Text>
      </View>

      <View style={styles.bottom}>
        {from && (
          <View style={styles.fromRow}>
            <Feather name="credit-card" size={14} color={colors.muted} />
            <Text style={styles.small} numberOfLines={1}>
              Usually from {from.label} · you pick in your UPI app
            </Text>
          </View>
        )}
        {!fixed && (
          <View style={styles.keys}>
            {KEYS.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={key === 'back' ? 'Delete' : key}
                onPress={() => press(key)}
                onLongPress={key === 'back' ? () => setText('') : undefined}
                style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
              >
                {key === 'back' ? <Feather name="delete" size={22} color={colors.text} /> : <Text style={styles.keyText}>{key}</Text>}
              </Pressable>
            ))}
          </View>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <Button title={amount ? `Pay ${formatAmount(amount).replace(/\.00$/, '')}` : 'Pay'} onPress={pay} loading={paying} disabled={!amount} />
        <Text style={[styles.small, styles.centerText]}>Android asks which UPI app to open. Money Plant never moves money itself.</Text>
      </View>
    </View>
  );
}

const TITLES: Record<UpiStatus, string> = {
  success: 'Paid',
  submitted: 'Payment is processing',
  failure: "The payment didn't go through",
  unknown: 'Did the payment go through?',
};

function Paid(props: { payment: UpiPayment; guess: PayeeGuess | null; result: PaymentResult; amount: Paise; at: string; onRetry: () => void }) {
  const { payment, result, amount } = props;
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [category, setCategory] = useState<{ id: string; name: string; key: string | null; hint: string | null } | null>(null);
  const [picked, setPicked] = useState(false);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const name = payment.payeeName ?? payment.payeeVpa;
  const id = result.transactionId;

  useEffect(() => {
    const guessed = props.guess?.decision?.categoryId;
    if (!guessed) return;
    Promise.all([categoryNames(), listCategories()]).then(([names, tree]) => {
      const node = flatten(tree).find((c) => c.id === guessed);
      if (node) setCategory({ id: node.id, name: names.get(node.id) ?? node.name, key: node.key, hint: props.guess?.hint ?? null });
    });
  }, [props.guess]);

  const unsure = (result.status === 'unknown' || result.status === 'submitted') && answered === null;
  const paid = result.status === 'success' || answered === true;
  const failed = result.status === 'failure' || answered === false;

  async function answer(wentThrough: boolean) {
    await settleUnconfirmed(id, wentThrough, props.guess?.decision ?? null);
    setAnswered(wentThrough);
  }

  async function finish(skip = false) {
    try {
      if (!skip && category && (picked || props.guess?.decision?.reason !== 'user')) await setCategoryForEntries([id], category.id);
      if (note.trim()) await editEntry(id, { note });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const title = paid ? `Paid ${formatAmount(amount).replace(/\.00$/, '')} to ${name}` : answered === null ? TITLES[result.status] : TITLES.failure;
  const subtitle = paid
    ? `${result.status === 'success' ? 'Confirmed by your UPI app' : 'You confirmed it'} · ${formatTime(props.at)}`
    : unsure
      ? "Your UPI app didn't say. If you're not sure, leave it: the bank SMS confirms it, or it waits in Review."
      : 'Nothing was logged. Try again, or pick another app.';

  return (
    <View style={styles.paidScreen}>
      <View style={[styles.paidTop, { paddingTop: insets.top + 64 }]}>
        <View style={[styles.doneIcon, failed && styles.doneIconFailed, unsure && styles.doneIconUnsure]}>
          <Feather name={paid ? 'check' : unsure ? 'help-circle' : 'x'} size={32} color={paid ? colors.primary : unsure ? colors.warning : colors.danger} />
        </View>
        <Text style={styles.doneTitle}>{title}</Text>
        <Text style={styles.doneText}>{subtitle}</Text>
        {unsure && (
          <View style={styles.answer}>
            <View style={styles.grow}>
              <Button title="Yes, it went through" onPress={() => answer(true)} />
            </View>
            <View style={styles.grow}>
              <Button title="No" variant="secondary" onPress={() => answer(false)} />
            </View>
          </View>
        )}
        {failed && (
          <View style={styles.answer}>
            <View style={styles.grow}>
              <Button title="Try again" onPress={props.onRetry} />
            </View>
            <View style={styles.grow}>
              <Button title="Close" variant="secondary" onPress={() => router.back()} />
            </View>
          </View>
        )}
      </View>

      {paid && (
        <View style={[styles.paidSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={styles.withoutTitle}>What was it for?</Text>
          <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [styles.categoryRow, category && styles.categoryChosen, pressed && styles.pressed]}>
            {category ? <CategoryIcon categoryKey={category.key} /> : <View style={styles.emptyIcon}><Feather name="tag" size={18} color={colors.muted} /></View>}
            <View style={styles.grow}>
              <Text style={styles.categoryName}>{category?.name ?? 'Pick a category'}</Text>
              {category?.hint && !picked && <Text style={styles.small}>{category.hint}</Text>}
            </View>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
          {noting && (
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="A note for yourself"
              placeholderTextColor={colors.placeholder}
              maxLength={120}
              autoFocus
              style={styles.sheetNote}
            />
          )}
          <View style={styles.answer}>
            <Pressable accessibilityRole="button" onPress={() => router.replace(`/expense?from=${id}`)} style={styles.tile}>
              <Feather name="users" size={16} color={colors.text} />
              <Text style={styles.tileText}>Split it</Text>
            </Pressable>
            {!isShop(payment) && (
              <Pressable accessibilityRole="button" onPress={() => router.replace(`/iou/new?from=${id}`)} style={styles.tile}>
                <Feather name="corner-up-right" size={16} color={colors.text} />
                <Text style={styles.tileText}>I lent it</Text>
              </Pressable>
            )}
            {!noting && (
              <Pressable accessibilityRole="button" onPress={() => setNoting(true)} style={styles.tile}>
                <Text style={styles.tileText}>Add a note</Text>
              </Pressable>
            )}
          </View>
          {error && <ErrorText>{error}</ErrorText>}
          <Button title="Done" onPress={() => finish()} />
          <Pressable accessibilityRole="button" onPress={() => finish(true)} style={styles.skip}>
            <Text style={styles.skipText}>Skip, I'll tag it later</Text>
          </Pressable>
        </View>
      )}

      <CategoryPicker
        visible={picking}
        flow="expense"
        onPick={async (node) => {
          const names = await categoryNames();
          setCategory({ id: node.id, name: names.get(node.id) ?? node.name, key: node.key, hint: null });
          setPicked(true);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  grow: { flex: 1, minWidth: 0 },
  meta: { fontSize: 13, color: colors.muted },
  small: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  centerText: { textAlign: 'center' },
  pressed: { opacity: 0.8 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  scan: { flex: 1, backgroundColor: SCAN_BG },
  scanHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  scanTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: SCAN_TEXT, marginLeft: 4 },
  scanBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#141816' },
  noCamera: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: SCAN_GREEN },
  line: { position: 'absolute', top: 0, left: 24, right: 24, height: 2, borderRadius: 1, backgroundColor: SCAN_GREEN, opacity: 0.8 },
  scanHint: { fontSize: 14, color: SCAN_MUTED, textAlign: 'center', paddingHorizontal: 24 },
  gallery: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: '#1F2522' },
  galleryText: { fontSize: 14, fontWeight: '600', color: SCAN_TEXT },
  without: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  withoutTitle: { fontSize: 13, fontWeight: '600', color: colors.muted },
  vpa: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.subtle },
  vpaInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  recent: { flexDirection: 'row', gap: 12 },
  recentItem: { width: 68, alignItems: 'center', gap: 6 },
  recentName: { fontSize: 12, color: colors.text, maxWidth: 68 },

  amountScreen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
  payee: { alignItems: 'center', gap: 6, marginTop: 8 },
  paying: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 },
  amountBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  amount: { fontSize: 56, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], maxWidth: '100%' },
  notePill: { minHeight: 36, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.subtle, justifyContent: 'center', maxWidth: '90%' },
  noteText: { fontSize: 14, color: colors.secondary },
  noteInput: { minWidth: 200, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.subtle, fontSize: 14, color: colors.text, textAlign: 'center' },
  bottom: { gap: 10 },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  keys: { flexDirection: 'row', flexWrap: 'wrap' },
  key: { width: '33.33%', height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  keyPressed: { backgroundColor: colors.pressed },
  keyText: { fontSize: 26, fontWeight: '500', color: colors.text },

  paidScreen: { flex: 1, backgroundColor: colors.background },
  paidTop: { flex: 1, alignItems: 'center', paddingHorizontal: 24, gap: 12 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  doneIconFailed: { backgroundColor: colors.subtle },
  doneIconUnsure: { backgroundColor: colors.warningSurface },
  doneTitle: { fontSize: 21, fontWeight: '700', color: colors.text, textAlign: 'center' },
  doneText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  answer: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  paidSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  categoryChosen: { borderColor: colors.primary, borderWidth: 1.5 },
  emptyIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  categoryName: { fontSize: 15, fontWeight: '600', color: colors.text },
  sheetNote: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.subtle, fontSize: 15, color: colors.text },
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tileText: { fontSize: 14, fontWeight: '600', color: colors.text },
  skip: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, color: colors.muted },
});
