import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { costFromAverage, formatRupees, parseRupees, scaleDecimal } from '@money-plant/core';
import type { LocalHolding } from '@money-plant/db-schema';
import { Button, Chip, Chips, ErrorText, Field, colors } from '@/components/ui';
import { getHolding, setHoldingCost } from '@/lib/demat';

/** NW-5: depository statements have no purchase price, so the user adds what they paid for a holding. */
export default function HoldingCost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [holding, setHolding] = useState<LocalHolding | null>(null);
  const [mode, setMode] = useState<'average' | 'total'>('average');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getHolding(id).then(setHolding);
  }, [id]);

  if (!holding) return null;
  const units = (holding.unitsE4 / 10_000).toLocaleString('en-IN', { maximumFractionDigits: 4 });
  const averageE4 = mode === 'average' ? scaleDecimal(text.replace(/[₹,\s]/g, ''), 4) : null;
  const total = mode === 'total' ? parseRupees(text) : averageE4 !== null ? costFromAverage(holding.unitsE4, averageE4) : null;

  async function save() {
    if (total === null || total < 0) return setError(mode === 'average' ? 'Enter the average price per unit, for example 1,234.50' : 'Enter the total you paid, for example 25,000');
    await setHoldingCost(id, mode === 'average' && averageE4 !== null ? { averagePriceE4: averageE4 } : { total });
    router.back();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{holding.symbol ?? holding.scheme}</Text>
      <Text style={styles.body}>
        {units} units. Your broker's holdings screen shows the average price you paid for each. It's used only to show your gain.
      </Text>
      <Chips>
        <Chip label="Average price" selected={mode === 'average'} onPress={() => setMode('average')} />
        <Chip label="Total paid" selected={mode === 'total'} onPress={() => setMode('total')} />
      </Chips>
      <Field
        label={mode === 'average' ? 'Average price per unit (₹)' : 'Total paid (₹)'}
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        keyboardType="decimal-pad"
        autoFocus
      />
      {mode === 'average' && total !== null && <Text style={styles.body}>That's {formatRupees(total)} in all.</Text>}
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title="Save" onPress={save} disabled={text.trim() === ''} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  actions: { marginTop: 16 },
});
