import { useState } from 'react';
import { Text, View } from 'react-native';
import { AccountPicker } from './account-picker';
import { Button, radius, makeStyles } from './ui';
import { ignoreSender, linkSender, setAppApproved, type CaptureQuestions } from '@/lib/senders';

/**
 * CAP-11 and CAP-12 in Review: a sender the app has no rules for, whose
 * messages wait until the user says which account they are for; and an app
 * outside the built-in list that posted a payment notification.
 */
export function CaptureQuestionCards({ questions, onError }: { questions: CaptureQuestions; onError: (message: string) => void }) {
  return (
    <>
      {questions.senders.map((s) => (
        <NewSender key={s.sender} sender={s.sender} name={s.name} waiting={s.waiting} onError={onError} />
      ))}
      {questions.apps.map((a) => (
        <NewApp key={a.packageName} packageName={a.packageName} name={a.name} onError={onError} />
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
      <Text style={styles.title}>New sender: {name}</Text>
      <Text style={styles.text}>
        {waiting} {waiting === 1 ? 'message about money is' : 'messages about money are'} waiting. Which account {waiting === 1 ? 'is it' : 'are they'} for?
        Nothing is added until you say.
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

function NewApp({ packageName, name, onError }: { packageName: string; name: string; onError: (message: string) => void }) {
  const styles = useStyles();
  const answer = (yes: boolean) => () => setAppApproved(packageName, yes).catch((e) => onError(e instanceof Error ? e.message : String(e)));
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Read payments from {name}?</Text>
      <Text style={styles.text}>
        {name} showed a notification about money. Money Plant hasn't read it. Say yes to read {name}'s payment notifications from now
        on; the text stays on this phone.
      </Text>
      <View style={styles.actions}>
        <Button title="Yes, read them" onPress={answer(true)} />
        <Button title="No" variant="secondary" onPress={answer(false)} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  text: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { gap: 8 },
}));
