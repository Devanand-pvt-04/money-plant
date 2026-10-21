import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { parseRupees } from '@money-plant/core';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { setCurrentBalance } from '@/lib/ledger';

/** The user types today's balance; the opening balance is worked out from it. */
export default function SetBalance() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const amount = parseRupees(text);
    if (amount === null) return setError('Enter the balance as a number, for example 12,500.50 (use - for money owed on a card)');
    await setCurrentBalance(id, amount);
    router.back();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.body}>
        Enter what the bank or card app shows right now. For a credit card, enter the amount owed as a negative number.
      </Text>
      <Field label="Current balance (₹)" value={text} onChangeText={setText} keyboardType="numbers-and-punctuation" autoFocus />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} disabled={text.trim() === ''} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 24 },
});
