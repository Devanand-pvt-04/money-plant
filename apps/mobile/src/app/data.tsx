import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { Sheet } from '@/components/sheet';
import { Button, Card, ErrorText, Field, SectionTitle, colors, radius } from '@/components/ui';
import { clearMyData, deleteAccount } from '@/lib/account';
import { exportData, type ExportResult } from '@/lib/export';

type Danger = 'clear' | 'delete';

const DANGER: Record<Danger, { title: string; word: string; button: string; points: string[] }> = {
  clear: {
    title: 'Clear all my data',
    word: 'CLEAR',
    button: 'Clear my data',
    points: [
      'Every entry, account, category, rule, budget, recurring payment, group and IOU is deleted from this phone and from the server.',
      'You stay signed in, with your name and UPI ID. The app starts again as on the first day, and you can import your SMS again.',
      'IOUs you shared are removed for your friends too. IOUs friends shared with you stay theirs and ask for your answer again.',
    ],
  },
  delete: {
    title: 'Delete my account',
    word: 'DELETE',
    button: 'Delete my account',
    points: [
      'Your sign-in and everything stored with it are deleted from the server, and this phone is emptied.',
      'IOUs a friend recorded stay in their ledger, no longer linked to you.',
      'This cannot be undone. Signing up again with the same email starts a new, empty account.',
    ],
  },
};

/** ACC-4 and ACC-7: export everything, clear it, or delete the account. */
export default function YourData() {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [danger, setDanger] = useState<Danger | null>(null);

  async function runExport() {
    setExporting(true);
    setError(null);
    try {
      const result = await exportData();
      if (result) setExported(result);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <SectionTitle>Export</SectionTitle>
        <Card style={styles.card}>
          <Text style={styles.body}>
            Saves your entries, accounts, budgets, recurring payments and IOUs as CSV files in a folder you pick, such as Downloads.
            They open in Excel or Google Sheets. SMS text is not included.
          </Text>
          {exported && (
            <Text style={styles.ok}>
              Saved {exported.files.length} files in {exported.folder}.
            </Text>
          )}
          <Button title="Export as CSV" variant="secondary" onPress={runExport} loading={exporting} />
        </Card>
        {error && <ErrorText>{error}</ErrorText>}

        <SectionTitle>Start over</SectionTitle>
        <Card>
          <DangerRow icon="refresh-ccw" title="Clear all my data" meta="Keep the account, remove everything in it" onPress={() => setDanger('clear')} first />
          <DangerRow icon="user-x" title="Delete my account" meta="Remove the account and all its data" onPress={() => setDanger('delete')} />
        </Card>
      </ScrollView>

      <Sheet visible={danger !== null} onClose={() => setDanger(null)} title={danger ? DANGER[danger].title : undefined}>
        {danger && (
          <Confirm
            key={danger}
            kind={danger}
            exported={exported !== null}
            exporting={exporting}
            onExport={runExport}
            onDone={() => {
              setDanger(null);
              // After a clear the user is still signed in: back to Home, which offers the first-run steps.
              if (danger === 'clear') router.dismissTo('/');
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function DangerRow(props: { icon: 'refresh-ccw' | 'user-x'; title: string; meta: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}>
      <Feather name={props.icon} size={18} color={colors.danger} />
      <View style={styles.grow}>
        <Text style={styles.dangerName}>{props.title}</Text>
        <Text style={styles.meta}>{props.meta}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** Typed confirmation, with the export offered first (ACC-4, ACC-7). */
function Confirm(props: { kind: Danger; exported: boolean; exporting: boolean; onExport: () => void; onDone: () => void }) {
  const copy = DANGER[props.kind];
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === copy.word;

  async function confirm() {
    setWorking(true);
    setError(null);
    try {
      await (props.kind === 'clear' ? clearMyData() : deleteAccount());
      props.onDone();
    } catch (e) {
      setError(`${props.kind === 'clear' ? "Couldn't clear your data" : "Couldn't delete your account"}. Check your connection and try again. (${e instanceof Error ? e.message : String(e)})`);
      setWorking(false);
    }
  }

  return (
    <View style={styles.confirm}>
      {copy.points.map((point) => (
        <View key={point} style={styles.point}>
          <View style={styles.bullet} />
          <Text style={[styles.body, styles.grow]}>{point}</Text>
        </View>
      ))}
      {props.exported ? (
        <Text style={styles.ok}>Your export is saved.</Text>
      ) : (
        <Button title="Export a copy first" variant="secondary" onPress={props.onExport} loading={props.exporting} />
      )}
      <Field
        label={`Type ${copy.word} to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={copy.word}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready || working }}
        disabled={!ready || working}
        onPress={confirm}
        style={({ pressed }) => [styles.dangerButton, (!ready || working) && styles.disabled, pressed && styles.pressedButton]}
      >
        {working ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.dangerButtonText}>{copy.button}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  card: { padding: 16, gap: 12 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  ok: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  dangerName: { fontSize: 15, fontWeight: '600', color: colors.danger },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  confirm: { gap: 12 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 7 },
  dangerButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  dangerButtonText: { fontSize: 16, fontWeight: '700', color: colors.onInk },
  disabled: { opacity: 0.4 },
  pressedButton: { opacity: 0.85 },
});
