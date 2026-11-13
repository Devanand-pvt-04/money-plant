import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { currencyInfo, formatMoney, paise, parseMoney, type CurrencyCode } from '@money-plant/core';
import { Button, ErrorText, Field, makeStyles } from '@/components/ui';
import { setCreditLimit } from '@/lib/cards';
import { listAccountBalances } from '@/lib/ledger';

/**
 * Decision 0024: a credit card's limit, typed once from the card app. With
 * it, the available limit in each card SMS says what the card really owes.
 * `suggest` and `from` come from a balance check that looks like a limit change.
 */
export default function CreditLimit() {
  const styles = useStyles();
  const { id, suggest, from } = useLocalSearchParams<{ id: string; suggest?: string; from?: string }>();
  const [text, setText] = useState('');
  const [current, setCurrent] = useState<number | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAccountBalances().then((all) => {
      const found = all.find((b) => b.account.id === id);
      if (!found) return;
      setCurrency(found.currency);
      setCurrent(found.account.creditLimitPaise);
      const start = suggest !== undefined && /^\d+$/.test(suggest) ? Number(suggest) : found.account.creditLimitPaise;
      if (start !== null) setText(formatMoney(paise(start), found.currency).replace(/^[^\d]+/, ''));
    });
  }, [id, suggest]);

  async function save(clear = false) {
    const parsed = clear ? null : parseMoney(text.trim().replace(/^[^\d]+/, ''), currency);
    if (!clear && (parsed === null || parsed <= 0)) return setError('Enter the limit as a number, for example 60,000');
    setSaving(true);
    try {
      await setCreditLimit(id, clear ? null : paise(parsed!), from);
      router.back();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.body}>
        Enter the total credit limit your card app shows. Card SMS print the limit you have left, so with this the app knows what the card really owes and can
        tell when a spend was missed.
      </Text>
      <Field label={`Credit limit (${currencyInfo(currency).symbol.trim()})`} value={text} onChangeText={setText} keyboardType="decimal-pad" autoFocus />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={() => save()} disabled={text.trim() === '' || saving} loading={saving} />
        {current !== null && <Button title="Remove the limit" variant="secondary" onPress={() => save(true)} disabled={saving} />}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, gap: 12 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 12, gap: 8 },
}));
