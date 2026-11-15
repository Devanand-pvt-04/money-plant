import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { currencyInfo, formatMoney, paise, type CurrencyCode } from '@money-plant/core';
import { formatWholeRupees } from './format';
import { radius, useColors, makeStyles } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;
type Key = (typeof KEYS)[number];
const MAX_WHOLE_DIGITS = 9;

/** "1250.5" typed on the keypad as integer minor units of `currency`, without floating point. */
export function toMinor(text: string, currency: CurrencyCode): number {
  const { decimals } = currencyInfo(currency);
  const [whole = '', fraction = ''] = text.split('.');
  return Number(whole || '0') * 10 ** decimals + Number(fraction.padEnd(decimals, '0').slice(0, decimals) || '0');
}

/** Minor units back to keypad text: 15000 paise is "150", 15050 is "150.50". */
export function fromMinor(amount: number, currency: CurrencyCode): string {
  return formatMoney(paise(amount), currency, { symbol: false })
    .replace(/,/g, '')
    .replace(/\.0+$/, '');
}

/** The amount as typed, grouped for its currency: "₹1,250.5", "$1,250.5". */
export function keypadDisplay(text: string, currency: CurrencyCode): string {
  const [whole = '', fraction] = text.split('.');
  const shown = formatWholeRupees(Number(whole || '0') * 10 ** currencyInfo(currency).decimals, currency);
  return fraction === undefined ? shown : `${shown}.${fraction}`;
}

function press(text: string, key: Key, decimals: number): string {
  if (key === 'del') return text.slice(0, -1);
  const [whole = '', fraction] = text.split('.');
  if (key === '.') return fraction !== undefined || decimals === 0 ? text : `${whole || '0'}.`;
  if (fraction !== undefined) return fraction.length >= decimals ? text : text + key;
  if (whole === '0') return key;
  return whole.length >= MAX_WHOLE_DIGITS ? text : text + key;
}

/**
 * The number pad of quick add (CAP-7), shared with the With someone screen
 * (decision 0030). Long-pressing delete clears the amount.
 */
export function Keypad(props: { currency: CurrencyCode; onChange: (update: (text: string) => string) => void; keyHeight?: number }) {
  const colors = useColors();
  const styles = useStyles();
  const decimals = currencyInfo(props.currency).decimals;
  return (
    <View style={styles.keys}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
          onPress={() => props.onChange((t) => press(t, k, decimals))}
          onLongPress={k === 'del' ? () => props.onChange(() => '') : undefined}
          style={({ pressed }) => [styles.key, props.keyHeight ? { height: props.keyHeight } : null, pressed && styles.keyPressed]}
        >
          {k === 'del' ? <Feather name="delete" size={22} color={colors.text} /> : <Text style={styles.keyText}>{k}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  keys: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8 },
  key: { width: '33.33%', height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  keyPressed: { backgroundColor: colors.pressed },
  keyText: { fontSize: 26, fontWeight: '500', color: colors.text },
}));
