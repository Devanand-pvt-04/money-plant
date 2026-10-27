import { type ComponentProps, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { Button, ErrorText, colors } from '@/components/ui';
import { giveConsent } from '@/lib/consent';
import { signOut } from '@/lib/session';

const POINTS: { icon: ComponentProps<typeof Feather>['name']; title: string; body: string }[] = [
  {
    icon: 'message-square',
    title: 'Bank SMS stay on this phone',
    body: 'With your permission, the app reads messages from banks and card companies only. The message text never leaves the phone; only the amount, date, account and payee are saved.',
  },
  {
    icon: 'cloud',
    title: 'Your ledger is kept in the cloud',
    body: 'Entries, accounts, budgets and IOUs sync to your account on Supabase (Mumbai), so a new phone gets them back. Only you can read them; a friend sees only an IOU you share with them.',
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
    title: 'AI runs on our own computer',
    body: 'Later, an AI model will suggest categories for unknown payees and write your month review. It runs on a computer the app owner controls, not an AI company, and gets only what each task needs, such as payee names and amounts: never SMS text or account numbers.',
  },
];

/** ACC-5: what the app does with your data, agreed to once after signing in. */
export default function Consent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await giveConsent();
    } catch (e) {
      setError(`Couldn't save that: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Before you start</Text>
        <Text style={styles.subtitle}>Money Plant fills your ledger mostly from bank SMS. Here's what happens to your data.</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, paddingBottom: 48, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, marginTop: 16 },
  subtitle: { fontSize: 16, color: colors.muted, lineHeight: 22 },
  point: { flexDirection: 'row', gap: 14 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  pointTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 8, gap: 12 },
});
