import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, ErrorText, Field, makeStyles } from '@/components/ui';
import { setBillingCycle } from '@/lib/cards';
import { listAccountBalances } from '@/lib/ledger';

/**
 * Decision 0024: a credit card's billing cycle. Statement SMS fill it in;
 * the user can set or correct it here.
 */
export default function BillingCycle() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [day, setDay] = useState('');
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAccountBalances().then((all) => {
      const found = all.find((b) => b.account.id === id);
      if (!found) return;
      if (found.account.statementDay !== null) setDay(String(found.account.statementDay));
      if (found.account.dueDays !== null) setDays(String(found.account.dueDays));
    });
  }, [id]);

  const asNumber = (text: string) => (text.trim() === '' ? null : /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

  async function save() {
    const statementDay = asNumber(day);
    const dueDays = asNumber(days);
    if (Number.isNaN(statementDay) || (statementDay !== null && (statementDay < 1 || statementDay > 31))) return setError('The statement day is a day of the month, 1 to 31');
    if (Number.isNaN(dueDays) || (dueDays !== null && dueDays > 60)) return setError('Days to pay is a number of days, usually 15 to 20');
    setSaving(true);
    try {
      await setBillingCycle(id, statementDay, dueDays);
      router.back();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.body}>
        The card's statement SMS teach the app these. With them, the card page shows this cycle's spending, and Home reminds you before the bill is due.
      </Text>
      <Field label="Statement day (day of the month)" value={day} onChangeText={setDay} keyboardType="number-pad" autoFocus />
      <Field label="Days to pay after the statement" value={days} onChangeText={setDays} keyboardType="number-pad" />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} disabled={saving} loading={saving} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, gap: 12 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 12 },
}));
