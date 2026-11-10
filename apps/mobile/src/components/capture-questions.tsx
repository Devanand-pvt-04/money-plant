import { useState } from 'react';
import { Text, View } from 'react-native';
import { AccountPicker } from './account-picker';
import { Button, radius, makeStyles } from './ui';
import { ignoreSender, linkSender, type CaptureQuestions } from '@/lib/senders';

/**
 * CAP-11 in Review: a sender whose messages didn't show which account they
 * are for. They wait until the user picks one. Any bank can be asked about.
 */
export function CaptureQuestionCards({ questions, onError }: { questions: CaptureQuestions; onError: (message: string) => void }) {
  return (
    <>
      {questions.senders.map((s) => (
        <NewSender key={s.sender} sender={s.sender} name={s.name} waiting={s.waiting} onError={onError} />
      ))}
    </>
  );
}

function NewSender({ sender, name, waiting, onError }: { sender: string; name: string; waiting: number; onError: (message: string) => void }) {
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Messages from {name}</Text>
      <Text style={styles.text}>
        {waiting} {waiting === 1 ? 'message about money from' : 'messages about money from'} {name} {waiting === 1 ? "doesn't" : "don't"} say which of
        your accounts {waiting === 1 ? 'it is' : 'they are'} for. Nothing is added until you pick one.
      </Text>
      <View style={styles.actions}>
        <Button title="Pick the account" onPress={() => setPicking(true)} loading={busy} />
        <Button title="Ignore this sender" variant="secondary" onPress={() => run(() => ignoreSender(sender))} disabled={busy} />
      </View>
      <AccountPicker
        visible={picking}
        title={`Messages from ${name} are for`}
        onClose={() => setPicking(false)}
        onPick={(account) => {
          setPicking(false);
          void run(() => linkSender(sender, account.account.id));
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  text: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { gap: 8 },
}));
