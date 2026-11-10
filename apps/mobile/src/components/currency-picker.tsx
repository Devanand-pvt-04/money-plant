import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { CURRENCIES, currencyInfo, type CurrencyCode } from '@money-plant/core';
import { Sheet } from './sheet';
import { radius, useColors, makeStyles } from './ui';

/** A searchable list of currencies, the current one ticked (ACC-11, ACC-12). */
export function CurrencyPicker(props: {
  visible: boolean;
  title: string;
  selected: CurrencyCode;
  onPick: (code: CurrencyCode) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...CURRENCIES.values()];
    return q ? all.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : all;
  }, [query]);

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title} tall>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search, like dollar or AED"
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        style={styles.search}
      />
      <FlatList
        data={list}
        keyExtractor={(c) => c.code}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: item.code === props.selected }}
            onPress={() => {
              setQuery('');
              props.onPick(item.code);
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.symbol}>{item.symbol.trim()}</Text>
            <View style={styles.text}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.code}>{item.code}</Text>
            </View>
            {item.code === props.selected && <Feather name="check" size={20} color={colors.primary} />}
          </Pressable>
        )}
      />
    </Sheet>
  );
}

/** "Indian rupee (INR)", for a row that opens the picker. */
export function currencyLabel(code: CurrencyCode): string {
  return `${currencyInfo(code).name} (${code})`;
}

const useStyles = makeStyles((colors) => ({
  search: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.subtle,
    fontSize: 15,
    color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 8, borderRadius: radius.md },
  pressed: { backgroundColor: colors.pressed },
  symbol: { width: 44, fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  text: { flex: 1 },
  name: { fontSize: 15, color: colors.text },
  code: { fontSize: 12, color: colors.muted },
}));
