import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { currencyInfo, paise, parseMoney, type CurrencyCode } from '@money-plant/core';
import { Button, ErrorText, Field, makeStyles } from '@/components/ui';
import { listAccountBalances, setCurrentBalance } from '@/lib/ledger';

/** The user types today's balance; the opening balance is worked out from it. */
export default function SetBalance() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Typed in the account's own currency (ACC-12).
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  useEffect(() => {
    listAccountBalances().then((all) => {
      const found = all.find((b) => b.account.id === id);
      if (found) setCurrency(found.currency);
    });
  }, [id]);

  async function save() {
    const parsed = parseMoney(text.trim().replace(/^[^\d-]+/, ''), currency);
    const amount = parsed === null ? null : paise(parsed);
    if (amount === null) return setError('Enter the balance as a number, for example 12,500.50 (use - for money owed on a card)');
    await setCurrentBalance(id, amount);
    router.back();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.body}>
        Enter what the bank or card app shows right now. For a credit card, enter the amount owed as a negative number.
      </Text>
      <Field label={`Current balance (${currencyInfo(currency).symbol.trim()})`} value={text} onChangeText={setText} keyboardType="numbers-and-punctuation" autoFocus />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} disabled={text.trim() === ''} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 24 },
}));
