import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatRupees, parseRupees, type Paise } from '@money-plant/core';
import { Sheet } from './sheet';
import { Button, ErrorText, colors, radius } from './ui';

const plain = (amount: Paise) => formatRupees(amount, { symbol: false }).replace(/\.00$/, '');

/**
 * BUD-1: asks for one budget amount. `onSave` gets the amount, or null from
 * the remove action, which is shown only when `removeLabel` is given.
 */
export function BudgetSheet(props: {
  visible: boolean;
  title: string;
  note?: string;
  value: Paise | null;
  removeLabel?: string;
  onSave: (limit: Paise | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible) return;
    setText(props.value === null ? '' : plain(props.value));
    setError(null);
  }, [props.visible, props.value]);

  function save() {
    const amount = parseRupees(text);
    if (amount === null || amount <= 0) return setError('Enter an amount above zero');
    props.onSave(amount);
  }

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title}>
      {props.note && <Text style={styles.note}>{props.note}</Text>}
      <View style={styles.amount}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="5,000"
          placeholderTextColor={colors.placeholder}
          keyboardType="decimal-pad"
          autoFocus
          accessibilityLabel="Budget amount"
          style={styles.input}
          onSubmitEditing={save}
        />
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Button title="Save" onPress={save} disabled={text.trim() === ''} />
      {props.removeLabel && (
        <Pressable accessibilityRole="button" onPress={() => props.onSave(null)} style={styles.remove} hitSlop={4}>
          <Text style={styles.removeText}>{props.removeLabel}</Text>
        </Pressable>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 14, color: colors.muted, marginHorizontal: 4 },
  amount: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 64, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.subtle },
  rupee: { fontSize: 28, fontWeight: '600', color: colors.muted },
  input: { flex: 1, fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], paddingVertical: 8 },
  remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 15, fontWeight: '600', color: colors.danger },
});
