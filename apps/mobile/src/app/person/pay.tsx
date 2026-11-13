import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { buildUpiUri, formatMoney, paise, type Paise } from '@money-plant/core';
import { formatAmount } from '@/components/format';
import { FormScroll } from '@/components/keyboard';
import { QrCode } from '@/components/qr-code';
import { Button, Card, ErrorText, MoneyCard, SectionTitle, figures, radius, useColors, makeStyles } from '@/components/ui';
import { extraVpasOf, getPerson, phoneOf, type Person } from '@/lib/people';
import { payLink } from '@/lib/shared';
import { copyText, openUpiApp, openUpiLink, UPI_APPS, type UpiApp } from '@/lib/upi';

interface Target {
  key: string;
  label: string;
  value: string;
}

/**
 * Paying a person by UPI. GPay, PhonePe and Paytm warn on or block
 * person-to-person payments started from another app's upi://pay link (UPI
 * risk rules), so the main way is: copy their UPI ID or mobile number, open
 * the UPI app, paste. Their UPI QR is here for scanning from another phone,
 * and the direct link stays for apps that still allow it (IOU-3, PAY-1).
 * Nothing here moves money. `?id=<person id>`.
 */
export default function PayPerson() {
  const colors = useColors();
  const styles = useStyles();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [person, setPerson] = useState<Person | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPerson(id).then(setPerson, (e) => setError(String(e?.message ?? e)));
  }, [id]);

  const name = person?.account.name ?? '';
  useEffect(() => {
    navigation.setOptions({ title: name ? `Pay ${name}` : 'Pay' });
  }, [navigation, name]);

  if (!person) return <View style={styles.container}>{error && <ErrorText>{error}</ErrorText>}</View>;

  const owe = person.balances.find((b) => b.currency === 'INR' && b.amount < 0);
  const amount = owe ? paise(-owe.amount) : null;
  const vpa = person.account.vpa;
  const phone = phoneOf(person);
  const targets: Target[] = [
    ...(vpa ? [{ key: 'vpa', label: 'UPI ID', value: vpa }] : []),
    ...(phone ? [{ key: 'phone', label: 'Mobile number', value: phone }] : []),
    ...extraVpasOf(person).map((v) => ({ key: `extra:${v}`, label: 'Other UPI ID', value: v })),
  ];
  const target = targets.find((t) => t.key === chosen) ?? targets[0] ?? null;
  const link = payLink(person);
  const qrSize = Math.min(240, width - 120);

  function copy(key: string, text: string) {
    try {
      copyText(text);
      setCopied(key);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyAndOpen(app: UpiApp) {
    if (target) copy(target.key, target.value);
    try {
      await openUpiApp(app);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <MoneyCard>
        <Text style={styles.heroLabel}>{amount ? `You owe ${name}` : `Nothing owed to ${name}`}</Text>
        {amount !== null && (
          <>
            <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatAmount(amount, 'INR')}
            </Text>
            <Text accessibilityRole="button" onPress={() => copy('amount', formatMoney(amount, 'INR', { symbol: false }).replace(/,/g, ''))} style={styles.heroLink}>
              {copied === 'amount' ? 'Amount copied' : 'Copy amount'}
            </Text>
          </>
        )}
      </MoneyCard>

      {targets.length === 0 ? (
        <Text style={styles.hint}>Add {name}'s UPI ID or mobile number from the pencil on their page to pay them from here.</Text>
      ) : (
        <>
          <SectionTitle>Pay to</SectionTitle>
          <Card>
            {targets.map((t, i) => {
              const on = t.key === target?.key;
              return (
                <Pressable
                  key={t.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.label} ${t.value}. Copy`}
                  onPress={() => {
                    setChosen(t.key);
                    copy(t.key, t.value);
                  }}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? colors.primary : colors.muted} />
                  <View style={styles.grow}>
                    <Text style={styles.rowLabel}>{t.label}</Text>
                    <Text style={styles.rowValue} numberOfLines={1} selectable>
                      {t.value}
                    </Text>
                  </View>
                  <Text style={styles.copy}>{copied === t.key ? 'Copied' : 'Copy'}</Text>
                </Pressable>
              );
            })}
          </Card>

          <SectionTitle>Copy and open</SectionTitle>
          <View style={styles.apps}>
            {UPI_APPS.map((app) => (
              <Pressable key={app.packageName} accessibilityRole="button" accessibilityLabel={`Copy and open ${app.name}`} onPress={() => void copyAndOpen(app)} style={({ pressed }) => [styles.app, pressed && styles.pressed]}>
                <Text style={styles.appName} numberOfLines={1}>
                  {app.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            Copies the {target?.key === 'phone' ? 'mobile number' : 'UPI ID'} and opens the app. Choose "Pay UPI ID or number" there, paste it
            {amount !== null ? `, and enter ${formatAmount(amount, 'INR')}` : ''}. UPI apps trust this more than a payment link from another app.
          </Text>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {vpa && (
        <>
          <SectionTitle>{name}'s UPI QR</SectionTitle>
          <Card style={styles.qrCard}>
            <QrCode value={qrValue(vpa, name, amount)} size={qrSize} />
            <Text style={styles.qrNote}>Scan it from another phone's UPI app.{amount !== null ? ' The amount is filled in.' : ''}</Text>
          </Card>
        </>
      )}

      {link && (
        <>
          <SectionTitle>Payment link</SectionTitle>
          <Button title="Open with the UPI link" variant="secondary" onPress={() => void openUpiLink(link).catch((e) => setError(String(e?.message ?? e)))} />
          <Text style={styles.hint}>The way the app paid before. Some UPI apps block it for payments to people.</Text>
        </>
      )}

      {amount !== null && (
        <View style={styles.actions}>
          <Button title="I've paid: settle up" onPress={() => router.replace(`/settle?person=${id}`)} />
          <Text style={styles.hint}>Once your bank's SMS is in, pick that payment on Settle up so it counts against what you owe.</Text>
        </View>
      )}
    </FormScroll>
  );
}

/** The UPI link in the QR: their UPI ID and name, and the amount when something is owed. */
function qrValue(vpa: string, name: string, amount: Paise | null): string {
  if (amount !== null) return buildUpiUri({ payeeVpa: vpa, payeeName: name, params: {} }, { amount, note: 'Money Plant' });
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name)}&cu=INR`;
}

const useStyles = makeStyles((colors) => ({
  container: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48, gap: 12 },
  heroLabel: { fontSize: 13, fontWeight: '500', color: colors.heroMuted },
  heroValue: { fontSize: 36, fontWeight: '700', color: colors.heroText, letterSpacing: -1, ...figures },
  heroLink: { fontSize: 13, fontWeight: '600', color: colors.heroAccent, textDecorationLine: 'underline', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 12, color: colors.muted },
  rowValue: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 2 },
  copy: { fontSize: 14, fontWeight: '600', color: colors.primary },
  apps: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  app: {
    flexGrow: 1,
    flexBasis: '45%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  appName: { fontSize: 15, fontWeight: '600', color: colors.text },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  qrCard: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  qrNote: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingHorizontal: 16 },
  actions: { marginTop: 12, gap: 8 },
}));
